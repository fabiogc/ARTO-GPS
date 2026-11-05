# ARTO | Gerenciamento de Obras Hospitalares — MVP

Painel executivo de orçamento e contratações, mobile-first (iPhone 390 px), para a obra inicial **Hospital Caicó**.
Next.js 16 + TypeScript + Tailwind 4 + Recharts, banco **SQLite local** (`node:sqlite`, nativo do Node 22) e login com papéis **admin** e **cliente**.

> **Dados sensíveis.** A planilha, o banco e os relatórios ficam em `data/private/` (ignorado pelo git).
> Este repositório contém **apenas código**. Nunca faça commit de `.xlsx`, `.db`, `.env*` ou relatórios.

---

## 1. Setup local

Requisitos: Node.js ≥ 22.13 (testado em 22.23).

```bash
npm install
mkdir -p data/private
cp /caminho/ARTO_Caico_Orcamento_V4_Quantificacao_Integral.xlsx data/private/
npm run setup        # gera .env.local com segredo e senhas aleatórias (mostradas uma única vez)
npm run import       # importa a V4 para data/private/arto.db + relatório de importação
npm run dev          # http://localhost:3000
```

Para produção local: `npm run build && npm run start`.

### Variáveis de ambiente (`.env.example`)

| Variável | Uso |
|---|---|
| `SESSION_SECRET` | Segredo HMAC da sessão (≥ 32 caracteres). Obrigatório. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` | Usuário administrador (vê propostas, fornecedores, edita). |
| `CLIENT_USERNAME` / `CLIENT_PASSWORD_HASH` | Visão do cliente (resumo, sem propostas/fornecedores/exportação). |
| `DATABASE_PATH` | Banco SQLite (padrão `data/private/arto.db`). |
| `V4_XLSX_PATH` | Planilha de origem (padrão `data/private/ARTO_Caico_…_Integral.xlsx`). |
| `LEGACY_JSON_PATH` | JSON do protótipo anterior, só para o relatório de divergências. |
| `COOKIE_SECURE` | `1` atrás de HTTPS. |

Gerar um hash manualmente: `npm run hash-password -- "senha-forte-com-10+-caracteres"` (formato `scrypt:…`, sem `$`, porque o carregador de `.env` do Next expande `$`).

---

## 2. Importação da V4

```bash
npm run import                              # idempotente: reimportar o mesmo arquivo não muda nada
npm run import -- --file outra.xlsx         # outra versão da planilha
npm run import -- --dry-run                 # só gera o relatório
npm run import -- --resolve keep-manual     # conflitos: manter edições feitas no app
npm run import -- --resolve accept-import   # conflitos: aplicar valores da planilha
```

- **Planilha original nunca é alterada.** O arquivo V4 foi gerado por OpenXML SDK (prefixo `x:` e caminhos absolutos nas relações); o importador normaliza uma *cópia em memória* para ler com `exceljs`.
- **Colunas localizadas pelo cabeçalho real** (com aliases), não por posição.
- **Fórmulas sem cache** (a V4 tem 1.600+): o valor em cache é registrado e ignorado; totais são recalculados no app a partir de quantidade × preço, propostas e contratos.
- **Chaves estáveis**: código do pacote, ID da proposta/contrato, código do grupo, slug da pendência. Cada registro guarda **aba e linha** (`source_records`), e todas as células de todas as 17 abas ficam preservadas em `sheet_rows` (tela *Planilha original*).
- **Edições manuais** (tabela `overrides`) sobrevivem à reimportação. Se a planilha mudar um campo que foi editado no app, gera-se um **conflito** pendente, resolvido no app (*Mais › Relatório*) ou via `--resolve`.
- Relatório: `data/private/import-report.md` / `.json` e tela *Relatório de importação* (cobertura, propostas sem pacote, propostas não somadas, valores fora da lista de validação, divergências, fontes, diferenças contra o JSON anterior, alertas).

### Regras de interpretação (lib/import/rules.ts)

| Situação na planilha | Tratamento |
|---|---|
| Proposta com código `MULTI` | Vínculo **inferido** pelas disciplinas citadas → pacotes de projeto do grupo 01; vira **um grupo sem rateio**. |
| Proposta de *projeto* ligada a pacote de *execução* | Vínculo **divergente**: preservada, listada no relatório, **fora dos totais**. |
| “Preço unitário / dia”, “/mês” | Tarifa/valor mensal: exibido com unidade, **nunca somado como total**. |
| “Opcional” no status/serviço | Opcional: fora dos totais (menção a opcional só no escopo não torna a proposta opcional). |
| “verbal” | Rotulado **“Informado verbalmente”**. |
| Coluna “Cenário estrutural” vazia | Cenário **inferido** pela descrição apenas nos grupos 01 (projeto estrutural) e 06; marcado “revisar”. |
| `Equipamentos …` (grupo 19, exceto cozinha/lavanderia) | Equipamento médico: total exibido com e sem. |
| Grupo 22 | Contingência/reserva. |

---

## 3. Regras financeiras implementadas (lib/finance.ts)

- **Três camadas separadas**: (A) orçamento de referência = quantidade × preço; (B) propostas; (C) contratos e medições. Nunca somadas entre si.
- **Estimativa atual / custo conhecido**: por pacote, *uma* fonte — contrato › proposta de referência › orçamento-base (mesma lógica da coluna K da V4).
- **Propostas concorrentes** não se somam: usa a marcada como referência ou, na falta, a de menor valor global comparável.
- **Contratado** só com contrato registrado (planilha ou formulário com confirmação explícita). Status “contratada” exige contrato.
- **Cenários estruturais** (concreto / metálica / LSF) são excludentes: só o ativo entra; sem cenário ativo, nenhum entra. Os valores paramétricos agregados da aba de cenários **não** são atribuídos a pacotes.
- **Ausência = `null`**, exibida como “Não precificado”; soma de conjunto vazio é `null`, não R$ 0. Todo total mostra **denominador e cobertura**.
- **Curva ABC**: só itens com valor; A até 80% (o item que cruza 80% é A), B até 95%, C o restante. Alternância itens/macroetapas e base estimativa/orçamento-base. Banner **PARCIAL** sempre que a cobertura for < 100%.
- **Custo/m²**: calculado sem equipamentos médicos e marcado “não significativo” enquanto a cobertura for < 50%.
- **Pendências por risco**: heurística documentada — sistemas críticos (estrutura, fundações, elétrica, HVAC, gases, incêndio, imagem, centro cirúrgico, CME) = alto; desempate pelo nº de pacotes sem preço nas macroetapas relacionadas. Pacotes sem cotação são ordenados pelo impacto da macroetapa (`CATEGORY_RISK`).

---

## 4. Telas

Navegação inferior: **Visão geral | Custos | Curva ABC | Propostas (admin) ou Pendências (cliente) | Mais**.

- *Visão geral*: KPIs (custo conhecido, contratado, pago, pacotes sem preço), banner de cobertura, camadas A/B/C, cenário ativo, indicadores com/sem equipamentos.
- *Custos*: 22 macroetapas com subtotal, nº de itens, sem valor, % do conhecido, barras proporcionais; ordenação por etapa/valor e filtros; drill-down macroetapa › pacote › detalhe (fonte, data-base, confiabilidade, status, propostas, contrato, linha original da planilha, histórico, edição).
- *Curva ABC*, *Propostas* (filtros por status, detalhe, concorrentes, motivo de exclusão, mudança de status, registro de contrato), *Busca global*, *Pendências*, *Estimado × contratado × realizado* (com lançamento de medições), *Cenários e referências*, *Cronograma*, *Relatório*, *Planilha original*, *Exportação CSV/JSON*.
- Formulários são HTML nativos com *server actions* (funcionam mesmo se o JavaScript falhar no Safari). Filtros são links (`?filtro=`), então **voltar/recarregar/compartilhar** preservam o estado. O botão “Voltar” usa o histórico real quando existe e um destino lógico quando a página foi aberta direto.

---

## 5. Testes

```bash
npm run typecheck
npm test                 # Vitest: 33 testes (finanças, ABC, cenários, null×0, propostas concorrentes, importação idempotente, conflitos, auth)
npm run build
npm run test:e2e         # Playwright 390×844 (toque): 12 cenários; banco e credenciais próprios em tests/e2e/.tmp
npm run test:all         # tudo acima em sequência
```

- Os testes unitários usam **planilha sintética** gerada no próprio teste (valores fictícios). Se a V4 real estiver em `data/private/`, um teste extra valida contagens e idempotência com ela (pulado no CI sem dados).
- Os E2E precisam da V4 em `data/private/` (importada para um banco temporário). Cobrem: login/negação, abas, abrir categoria, abrir item, voltar (inclusive link direto), filtros e ordenação, busca, alternância ABC, propostas, edição de preço, cenário exclusivo, pendências, visão cliente, exportação, ausência de rolagem horizontal e de erros de console.

---

## 6. Publicação segura (Fase 5 — ainda não executada)

**Nada foi publicado.** Antes de qualquer deploy:

1. **Torne o repositório GitHub privado** (hoje está público). Mesmo sem dados, ele expõe a estrutura do orçamento.
2. **Nunca envie a planilha ou o banco pelo git.** Envie o `.xlsx` diretamente ao servidor (scp / upload) e rode `npm run import` lá.
3. Gere segredos novos no servidor (`npm run setup` ou variáveis do provedor). Use senhas fortes e diferentes para admin e cliente. Defina `COOKIE_SECURE=1`.
4. Sirva **somente via HTTPS**. Cabeçalhos já configurados: `X-Frame-Options: DENY`, `nosniff`, `noindex`. `robots.txt` bloqueia indexação.

**Opção recomendada para o MVP (persistência com SQLite):** um container/VM com **volume persistente** (ex.: Render, Railway, Fly.io ou VPS) executando `npm ci && npm run build && npm run start`, com `DATABASE_PATH` apontando para o volume. Faça backup do arquivo `.db` (ou use *Mais › Backup JSON*).

**Vercel:** o sistema de arquivos é somente leitura/efêmero — SQLite não persiste edições. Para Vercel, a evolução prevista é **Supabase Postgres + Auth + RLS** (trocar `lib/repo.ts` por um repositório Postgres com o mesmo modelo; políticas RLS por papel). Isso requer credenciais e autorização explícita do responsável. Não use “Vercel + banco embutido no deploy” com dados reais.

Checklist pós-deploy: abrir `/api/health` (`{"ok":true,"db":true,"auth":true}`), confirmar que `/custos` sem login redireciona para `/login`, que o cliente recebe 403 em `/api/export`, e testar no Safari do iPhone.

---

## 7. Limitações conhecidas

- A V4 **não tem nenhum pacote com quantidade × preço** (0 de 197). O custo conhecido vem apenas de propostas com valor global e é uma fração mínima do hospital; o app sinaliza isso em todas as telas. **Custo total do hospital: não apurado.**
- O subtotal da pesquisa V2 e os cenários estruturais são **paramétricos e agregados** — exibidos só como referência, nunca no custo conhecido.
- Vínculos inferidos (propostas MULTI, cenários estruturais) e a heurística de risco precisam de revisão humana.
- Sem contratos, medições, datas de cronograma ou fluxo mensal na V4: as telas mostram estados vazios explicativos.
- Autenticação simples por variáveis de ambiente (2 usuários). Multiusuário/convites/RLS ficam para a fase Supabase.
- Exportação XLSX e upload de documentos (propostas em PDF) ficam para fase posterior; referências a arquivos são texto.
- Testado em Chromium emulando iPhone 390×844 com toque. **Não testado em Safari/WebKit real** neste ambiente — validar no aparelho.
- `node:sqlite` emite aviso “experimental” no Node 22 (funcional e estável para este uso).
