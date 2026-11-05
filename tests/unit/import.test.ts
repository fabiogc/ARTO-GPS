import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { openDb } from '@/lib/db'
import { buildCostUnits, summarize } from '@/lib/finance'
import { applyImport, normalizeV4 } from '@/lib/import/import-v4'
import { parseV4 } from '@/lib/import/parse-v4'
import { detectAmountKind, detectLinkDivergence, inferMultiPackages, inferScenario, normalizeQuoteStatus } from '@/lib/import/rules'
import { loadDataset, openConflicts, setOverrides } from '@/lib/repo'

const ITEM_HEADERS = ['Código', 'Grupo', 'Macroetapa', 'Pacote / serviço', 'Unid.', 'Qtde', 'Preço base unit.', 'Orçado base R$', 'Cotação referência R$', 'Contratado R$', 'Estimativa atual R$', 'Diferença vs base R$', 'Cotação', 'Situação', 'Fornecedor escolhido', 'Base / fonte', 'Data referência', 'Link documento', 'Responsável', 'Observações', 'Cenário estrutural']

/** Planilha SINTÉTICA com a mesma estrutura de cabeçalhos da V4 (valores fictícios só para teste). */
async function buildWorkbook(path: string, opts: { price0101?: number | null } = {}) {
  const wb = new ExcelJS.Workbook()
  const add = (name: string, headers: string[], rows: unknown[][]) => {
    const ws = wb.addWorksheet(name)
    ws.addRow(headers)
    rows.forEach((r) => ws.addRow(r))
    return ws
  }
  const it = (code: string, cat: string, desc: string, qty: number | null = null, price: number | null = null) => {
    const r = [code, code.slice(0, 2), cat, desc, 'serv', qty, price, null, null, null, null, null, 'Não cotado', 'Não iniciado']
    return r
  }
  const ws = add('Orcamento detalhado', ITEM_HEADERS, [
    it('01.001', 'Projetos', 'Estudo de viabilidade', 1, opts.price0101 === undefined ? 1000 : opts.price0101),
    it('01.011', 'Projetos', 'Projeto elétrica e SPDA'),
    it('01.012', 'Projetos', 'Projeto hidráulica e esgoto'),
    it('04.005', 'Terreno', 'Terraplanagem corte e aterro'),
    it('06.001', 'Estrutura', 'Estrutura concreto armado moldado in loco'),
    it('06.003', 'Estrutura', 'Estrutura metálica principal'),
  ])
  ws.getCell('H2').value = { formula: 'IF(OR(F2="",G2=""),"",F2*G2)' } as ExcelJS.CellFormulaValue
  add('Propostas fornecedores', ['ID proposta', 'Código pacote', 'Serviço', 'Fornecedor', 'Data recebimento', 'Valor total R$', 'Inclui impostos?', 'Frete / viagem R$', 'Valor comparável R$', 'Status'], [
    ['P-MULTI', 'MULTI', 'Projetos elétrica e hidrossanitário', 'Fornecedor X', '2026-10-01', 5000, null, null, null, 'Proposta recebida'],
    ['P-DIA', '04.005', 'Controle diário', 'Fornecedor Y', null, 100, null, null, null, 'Preço unitário / dia'],
    ['P-PROJ', '04.005', 'Projeto executivo de terraplenagem', 'Fornecedor Y', null, 300, null, null, null, 'Proposta recebida'],
  ])
  add('Contratos e medicoes', ['Contrato ID', 'Código pacote', 'Fornecedor', 'Objeto', 'Valor original R$', 'Aditivos R$', 'Valor atualizado R$', 'Medido acumulado R$', 'Pago acumulado R$'], [])
  add('Cronograma marcos', ['ID', 'Fase', 'Marco / entrega', 'Início previsto', 'Fim previsto', 'Início real', 'Fim real', 'Duração prevista (dias)', '% avanço', 'Responsável', 'Dependência', 'Situação'], [['M-1', 'Pré', 'Marco', null, null, null, null, null, null, null, null, 'Não iniciado']])
  add('Fluxo mensal', ['Mês', 'A', 'B', 'C', 'D', 'E', 'F', 'Total planejado R$', 'Realizado R$'], [])
  add('Cenarios estruturais V2', ['Alternativa', 'Direto R$', 'Com BDI R$', 'Comparabilidade', 'Observações'], [['Concreto armado', 10, null, 'Paramétrico', ''], ['Estrutura metálica', 20, null, 'Sensibilidade', ''], ['LSF / fechamento', 5, null, 'NÃO COMPARÁVEL', ''], ['AVISO', null, null, 'NÃO SOMAR', '']])
  add('V4 Pendencias criticas', ['Pacote crítico', 'Informação necessária', 'Documento base', 'Status'], [['Fundações', 'SPT', 'Sondagem', 'Sem quantitativo']])
  add('Pesquisa aprofundada V2', ['PESQUISA APROFUNDADA — teste', 'Valor', 'Unidade / natureza', 'Observações / limitações', 'Fonte'], [['BDI de sensibilidade', 0.2, 'fração', '', '']])
  add('Bases e premissas', ['Referência', 'Tipo', 'Valor / informação', 'Data', 'Fonte / URL', 'Observações'], [['Área total construída', 'Projeto', 100, null, null, null]])
  add('V4 Base fisica e limites', ['BASE FÍSICA CONFIRMADA — teste', 'Valor', 'Unidade', 'Fonte / critério'], [['Térreo', 60, 'm²', ''], ['Segundo pavimento', 40, 'm²', '']])
  add('Abrangencia e limites', ['CONTROLE DE ABRANGÊNCIA', 'Valor', 'Origem', 'Interpretação'], [])
  add('Resumo por macroetapa', ['Grupo', 'Macroetapa', 'Base R$', 'Estimativa atual R$', 'Contratado R$', 'Pacotes', 'Propostas'], [['01', 'Projetos']])
  await wb.xlsx.writeFile(path)
}

function dump(db: ReturnType<typeof openDb>) {
  const tables = ['projects', 'categories', 'items', 'suppliers', 'quotes', 'quote_items', 'contracts', 'contract_items', 'measurements', 'scenarios', 'pendencias', 'milestones', 'cashflow', 'reference_values', 'source_records', 'sheet_rows', 'overrides']
  return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()]))
}

async function importFile(file: string, dbPath: string, resolution: 'ask' | 'keep-manual' | 'accept-import' = 'ask') {
  const db = openDb(dbPath)
  const report = applyImport(db, normalizeV4(await parseV4(file)), { resolution, now: '2026-01-01T00:00:00Z' })
  return { db, report }
}

describe('regras de interpretação', () => {
  it('status textual → enum, preservando "não contratado"', () => {
    expect(normalizeQuoteStatus('Opcional não contratado')).toBe('recebida')
    expect(normalizeQuoteStatus('Contratado')).toBe('contratada')
    expect(normalizeQuoteStatus('Pré-orçamento aguardado')).toBe('solicitada')
    expect(normalizeQuoteStatus('Executado — valor a confirmar')).toBe('em_analise')
  })
  it('tipo de valor: opcional só pela identidade; tarifa e mensal pelo contexto', () => {
    expect(detectAmountKind(1000, ['Proposta recebida', 'Projetos'], 'P1', ['Aprovação opcional à parte']).kind).toBe('global')
    expect(detectAmountKind(20, ['Opcional não contratado'], 'OPT-1').kind).toBe('opcional')
    expect(detectAmountKind(480, ['Preço unitário / dia'], 'P2')).toEqual({ kind: 'unitario', unitLabel: 'R$/dia' })
    expect(detectAmountKind(12, ['Valor informado verbalmente'], 'P3', ['R$ 12.500/mês']).kind).toBe('mensal')
    expect(detectAmountKind(null, [], 'P4').kind).toBe('sem_valor')
  })
  it('vínculos: MULTI inferido por disciplina, projeto × execução divergente', () => {
    const items = [{ code: '01.011', group: '01', description: 'Projeto elétrica e SPDA' }, { code: '01.012', group: '01', description: 'Projeto hidráulica e esgoto' }, { code: '10.001', group: '10', description: 'Entrada de energia elétrica' }]
    expect(inferMultiPackages('Projetos elétrica e hidrossanitário', items)).toEqual(['01.011', '01.012'])
    expect(detectLinkDivergence('Projeto executivo de terraplenagem', { code: '04.005', group: '04', description: 'Terraplanagem corte e aterro' })).toMatch(/PROJETO/)
    expect(detectLinkDivergence('Controle tecnológico', { code: '03.013', group: '03', description: 'Controle tecnológico e ensaios' })).toBeNull()
  })
  it('cenário inferido apenas para estrutura', () => {
    expect(inferScenario('06', 'Light steel frame estrutural')).toBe('lsf')
    expect(inferScenario('06', 'Lajes steel deck')).toBe('metalica')
    expect(inferScenario('01', 'Projeto estrutural concreto armado')).toBe('concreto')
    expect(inferScenario('08', 'Fechamentos em LSF')).toBe('base')
    expect(inferScenario('06', 'Escadas e rampas estruturais')).toBe('base')
  })
})

describe('importação idempotente (planilha sintética)', () => {
  it('reimportar o mesmo arquivo não altera nenhuma linha', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arto-'))
    const file = join(dir, 'v4.xlsx')
    await buildWorkbook(file)
    const a = await importFile(file, join(dir, 'a.db'))
    const first = dump(a.db)
    const b = applyImport(a.db, normalizeV4(await parseV4(file)), { now: '2026-02-02T00:00:00Z' })
    expect(dump(a.db)).toEqual(first)
    const changed = Object.values(b.sync!).reduce((n, s) => n + s.inserted + s.updated + s.removed, 0)
    expect(changed).toBe(0)
    // Banco novo, mesmo arquivo → mesmo conteúdo (determinístico)
    const c = await importFile(file, join(dir, 'c.db'))
    expect(dump(c.db)).toEqual(first)
  })

  it('preserva NULL, registra aba/linha, ignora cache de fórmula e trata propostas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arto-'))
    const file = join(dir, 'v4.xlsx')
    await buildWorkbook(file)
    const { db, report } = await importFile(file, join(dir, 'a.db'))
    const ds = loadDataset(db)
    expect(ds.items).toHaveLength(6)
    expect(ds.items.find((i) => i.code === '01.011')!.unitPrice).toBeNull()
    expect(ds.items.find((i) => i.code === '01.001')!.sheetRow).toBe(2)
    const multi = ds.quotes.find((q) => q.id === 'P-MULTI')!
    expect(multi.itemCodes).toEqual(['01.011', '01.012'])
    expect(multi.linkStatus).toBe('inferido')
    expect(ds.quotes.find((q) => q.id === 'P-PROJ')!.linkStatus).toBe('divergente')
    expect(ds.quotes.find((q) => q.id === 'P-DIA')!.amountKind).toBe('unitario')
    expect(report.coverage.quotesWithoutItem.map((q) => q.id)).toEqual(['P-PROJ'])
    const s = summarize(ds, { activeScenario: null, includeMedicalEquipment: true }, buildCostUnits(ds))
    expect(s.estimateTotal).toBe(6000) // 1000 (referência) + 5000 (grupo MULTI); tarifa e proposta divergente fora
    expect(s.inScopeItems).toBe(4) // 06.001 e 06.003 são alternativas excludentes
  })

  it('simulação (dry-run) informa mudanças sem alterar o banco', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arto-'))
    const file = join(dir, 'v4.xlsx')
    await buildWorkbook(file)
    const { db } = await importFile(file, join(dir, 'a.db'))
    const before = dump(db)
    const runs = (db.prepare('SELECT COUNT(*) AS n FROM import_runs').get() as { n: number }).n
    await buildWorkbook(file, { price0101: 4321 })
    const r = applyImport(db, normalizeV4(await parseV4(file)), { dryRun: true })
    expect(r.sync!.items.updated).toBe(1)
    expect(dump(db)).toEqual(before)
    expect((db.prepare('SELECT COUNT(*) AS n FROM import_runs').get() as { n: number }).n).toBe(runs)
  })

  it('edição manual sobrevive à reimportação e mudança na planilha gera conflito', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arto-'))
    const file = join(dir, 'v4.xlsx')
    await buildWorkbook(file)
    const { db } = await importFile(file, join(dir, 'a.db'))
    setOverrides('item', '01.011', { quantity: 2, unitPrice: 50, priceType: 'proposta' }, 'teste', db)
    applyImport(db, normalizeV4(await parseV4(file)))
    expect(loadDataset(db).items.find((i) => i.code === '01.011')!.unitPrice).toBe(50)
    expect(openConflicts(db)).toHaveLength(0)

    // Planilha muda um campo que NÃO foi editado → aplica sem conflito
    await buildWorkbook(file, { price0101: 1200 })
    applyImport(db, normalizeV4(await parseV4(file)))
    expect(loadDataset(db).items.find((i) => i.code === '01.001')!.unitPrice).toBe(1200)

    // Edição manual em 01.001 e depois a planilha muda o mesmo campo → conflito pendente, manual mantido
    setOverrides('item', '01.001', { unitPrice: 999 }, 'teste', db)
    await buildWorkbook(file, { price0101: 1500 })
    const r = applyImport(db, normalizeV4(await parseV4(file)))
    expect(r.conflicts).toHaveLength(1)
    expect(openConflicts(db)).toHaveLength(1)
    expect(loadDataset(db).items.find((i) => i.code === '01.001')!.unitPrice).toBe(999)
    // Decisão explícita: aceitar a planilha
    applyImport(db, normalizeV4(await parseV4(file)), { resolution: 'accept-import' })
    expect(loadDataset(db).items.find((i) => i.code === '01.001')!.unitPrice).toBe(1500)
  })
})

const REAL = process.env.V4_XLSX_PATH || 'data/private/ARTO_Caico_Orcamento_V4_Quantificacao_Integral.xlsx'
describe.skipIf(!existsSync(REAL))('planilha V4 real (local, não versionada)', () => {
  it('contagens, cobertura e idempotência', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arto-real-'))
    const { db, report } = await importFile(REAL, join(dir, 'r.db'))
    expect(report.coverage.items).toBe(197)
    expect(report.coverage.categories).toBe(22)
    expect(report.counts.quotes).toBe(9)
    expect(report.counts.contracts).toBe(0)
    expect(report.coverage.referencePriced).toBe(0)
    const before = dump(db)
    applyImport(db, normalizeV4(await parseV4(REAL)))
    expect(dump(db)).toEqual(before)
    const ds = loadDataset(db)
    const s = summarize(ds)
    // Nenhum contrato: contratado/pago ausentes (não zero). Alternativas fora sem cenário ativo.
    expect(s.contractedTotal).toBeNull()
    expect(s.paidTotal).toBeNull()
    expect(s.excludedByScenario).toBe(10)
    // Gerenciamento de obra = propostas internas ARTO
    expect(ds.quotes.filter((q) => q.isInternal).every((q) => q.itemCodes.every((c) => c.startsWith('03.')))).toBe(true)
    expect(ds.quotes.filter((q) => q.isInternal).length).toBeGreaterThan(0)
    // Tarifas, valores mensais, opcionais e vínculos divergentes nunca compõem a estimativa
    const chosen = new Set(buildCostUnits(ds).map((u) => u.chosenQuote?.id).filter(Boolean))
    for (const q of ds.quotes.filter((x) => x.amountKind !== 'global' || x.linkStatus === 'divergente')) expect(chosen.has(q.id)).toBe(false)
    expect(ds.quotes.some((q) => q.amountKind === 'unitario')).toBe(true)
    expect(ds.quotes.some((q) => q.amountKind === 'mensal' && q.isVerbal)).toBe(true)
  })
})
