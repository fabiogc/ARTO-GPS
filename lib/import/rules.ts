/**
 * Regras de interpretação da planilha V4. Todas documentadas e sem valores monetários embutidos.
 * Quando uma regra é heurística, o resultado é marcado como inferido para revisão humana.
 */
import type { AmountKind, CostKind, QuoteStatus, Scenario } from '../types'

export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function slug(s: string): string {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

/** Status textual livre da planilha → enum do app. O texto original é sempre preservado. */
export function normalizeQuoteStatus(raw: string | null): QuoteStatus {
  const s = norm(raw)
  if (!s) return 'recebida'
  if (/descart|cancel|recusad/.test(s)) return 'descartada'
  if (/nao contratad/.test(s)) return 'recebida'
  if (/contratad/.test(s)) return 'contratada'
  if (/aprovad/.test(s)) return 'aprovada'
  if (/negocia/.test(s)) return 'negociacao'
  if (/aguardad|solicitad|pendente/.test(s)) return 'solicitada'
  if (/analise|equaliz|executado|confirmar/.test(s)) return 'em_analise'
  return 'recebida'
}

/**
 * Tipo do valor. `identity` = status + serviço (define se a proposta É opcional);
 * `context` = também escopo/notas (define unidade: R$/dia, R$/mês). O escopo pode citar
 * um opcional à parte sem que a proposta principal seja opcional.
 */
export function detectAmountKind(amount: number | null, identity: Array<string | null>, id: string, context: Array<string | null> = []): { kind: AmountKind; unitLabel: string | null } {
  const idText = norm(identity.filter(Boolean).join(' | '))
  const t = norm([...identity, ...context].filter(Boolean).join(' | '))
  if (amount === null) return { kind: 'sem_valor', unitLabel: null }
  if (/opcional/.test(idText) || /^opt[-_]/i.test(id)) return { kind: 'opcional', unitLabel: null }
  if (/\/\s*dia|por dia|diari|preco unitario|preco diario/.test(t)) return { kind: 'unitario', unitLabel: 'R$/dia' }
  if (/\/\s*mes|mensal|por mes/.test(t)) return { kind: 'mensal', unitLabel: 'R$/mês' }
  return { kind: 'global', unitLabel: null }
}

export function detectVerbal(texts: Array<string | null>): boolean {
  return /verbal|verbalmente/.test(norm(texts.filter(Boolean).join(' ')))
}

/** Disciplinas citadas em propostas MULTI → padrão no nome do pacote de projeto (grupo 01). */
const DISCIPLINES: Array<[RegExp, RegExp]> = [
  [/eletric/, /eletric/],
  [/hidr|sanit/, /hidraul|sanit/],
  [/climatiz|hvac|ar condicionado/, /hvac|climatiz/],
  [/gases/, /gases/],
  [/incendio/, /incendio/],
  [/telecom|dados/, /telecom/],
  [/automac/, /automac/],
  [/paisag/, /paisag/],
  [/sinaliz/, /sinaliz/],
]

export function inferMultiPackages(service: string, items: Array<{ code: string; group: string; description: string }>): string[] {
  const s = norm(service)
  if (!/projeto/.test(s)) return []
  const found = new Set<string>()
  for (const [inService, inItem] of DISCIPLINES) {
    if (!inService.test(s)) continue
    for (const it of items) {
      const d = norm(it.description)
      if (it.group === '01' && d.startsWith('projeto') && inItem.test(d)) found.add(it.code)
    }
  }
  return [...found].sort()
}

/** Detecta proposta cujo escopo não corresponde ao pacote indicado (ex.: projeto × execução). */
export function detectLinkDivergence(service: string, item: { code: string; group: string; description: string }): string | null {
  const s = norm(service)
  const d = norm(item.description)
  const itemIsDesign = item.group === '01' || d.startsWith('projeto')
  if (/^projeto/.test(s) && !itemIsDesign) {
    return `Proposta de PROJETO vinculada ao pacote de EXECUÇÃO ${item.code} (“${item.description}”). Não somada ao pacote.`
  }
  if (/aprovac/.test(s) && item.group !== '02' && d.startsWith('projeto')) {
    return `Proposta de APROVAÇÃO vinculada ao pacote de PROJETO ${item.code}. Avaliar pacote de licenças (grupo 02).`
  }
  return null
}

const SCENARIO_LABELS: Array<[RegExp, Scenario]> = [
  [/^base$/, 'base'],
  [/concreto/, 'concreto'],
  [/metalic/, 'metalica'],
  [/lsf|light steel/, 'lsf'],
  [/definir/, 'a_definir'],
]

export function parseScenarioLabel(raw: string | null): Scenario | null {
  const s = norm(raw)
  if (!s) return null
  for (const [re, sc] of SCENARIO_LABELS) if (re.test(s)) return sc
  return null
}

/**
 * Inferência quando a coluna "Cenário estrutural" está vazia.
 * Só se aplica a projetos estruturais (grupo 01) e à macroetapa de estrutura (06).
 */
export function inferScenario(group: string, description: string): Scenario {
  const d = norm(description)
  const structuralDesign = group === '01' && /^projeto (estrutur|light steel)/.test(d)
  if (group !== '06' && !structuralDesign) return 'base'
  if (/light steel|\blsf\b/.test(d)) return 'lsf'
  if (/metalic|steel deck|chumbador|contravent/.test(d)) return 'metalica'
  if (/concreto|lajes convencionais/.test(d)) return 'concreto'
  return 'base'
}

export function inferCostKind(group: string, description: string): CostKind {
  const d = norm(description)
  if (group === '22') return 'contingencia'
  if (/^equipamentos/.test(d) && !/cozinha|lavanderia/.test(d)) return 'equipamento_medico'
  return 'direto'
}

/** Pendências críticas → macroetapas relacionadas (para ordenar por impacto). */
const PENDENCIA_GROUPS: Array<[RegExp, string[]]> = [
  [/topograf|terra/, ['04']],
  [/fundac/, ['05']],
  [/^estrutura/, ['06']],
  [/vedac|fachad/, ['07', '08']],
  [/impermeab/, ['09']],
  [/climatiz|hvac/, ['12']],
  [/eletric|spda/, ['10']],
  [/gases/, ['13']],
  [/hidross/, ['11']],
  [/incendio/, ['14']],
  [/\bti\b|cftv|acesso/, ['15']],
  [/imagem|centro cirurg|cme|endoscop/, ['19']],
  [/elevador/, ['16']],
  [/acabament/, ['17', '18']],
  [/comission/, ['21']],
  [/licenc/, ['02']],
  [/gerenciam/, ['03']],
]

export function pendenciaGroups(title: string): string[] {
  const t = norm(title)
  for (const [re, g] of PENDENCIA_GROUPS) if (re.test(t)) return g
  return []
}

/**
 * Nível de risco (heurística do app, documentada no README): sistemas críticos hospitalares
 * e itens que bloqueiam aprovação sanitária/segurança = alto.
 */
export function pendenciaRiskTier(title: string, statusRaw: string): 'alto' | 'medio' | 'baixo' {
  const t = norm(title)
  const st = norm(statusRaw)
  if (/estrutura|fundac|climatiz|gases|eletric|incendio|centro cirurg|imagem|cme/.test(t)) return 'alto'
  if (/definir|sem cotacao|sem quantitativo|nao equalizad/.test(st)) return 'medio'
  return 'baixo'
}

/**
 * Impacto por macroetapa para ordenar pacotes sem cotação (heurística documentada no README):
 * alto = sistemas críticos hospitalares, estrutura e equipamentos; baixo = projetos, gestão e reservas.
 */
export const CATEGORY_RISK: Record<string, 'alto' | 'medio' | 'baixo'> = {
  '05': 'alto', '06': 'alto', '10': 'alto', '12': 'alto', '13': 'alto', '14': 'alto', '16': 'alto', '19': 'alto',
  '02': 'medio', '04': 'medio', '07': 'medio', '08': 'medio', '09': 'medio', '11': 'medio', '15': 'medio', '17': 'medio', '18': 'medio', '20': 'medio', '21': 'medio',
  '01': 'baixo', '03': 'baixo', '22': 'baixo',
}
