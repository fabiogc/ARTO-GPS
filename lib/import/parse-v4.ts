/**
 * Leitura determinística da planilha V4. Não altera o arquivo de origem.
 * - Localiza colunas pelo texto real do cabeçalho (com aliases), não por posição fixa.
 * - Fórmulas: o valor em cache é registrado mas NUNCA usado; totais são recalculados no app.
 * - Cada registro guarda aba e linha de origem.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { parseBRNumber } from '../format'
import type { Confidence, PriceType } from '../types'
import { norm } from './rules'

export interface CellInfo {
  v: string | number | boolean | null
  f?: string
  cached?: string | number | boolean | null
}

export interface Issue {
  level: 'erro' | 'alerta' | 'info'
  code: string
  sheet?: string
  row?: number
  message: string
}

export interface RawItem {
  sheetRow: number
  code: string
  group: string
  categoryName: string
  description: string
  unit: string | null
  quantity: number | null
  unitPrice: number | null
  quotedRef: number | null
  contracted: number | null
  quoteStatusRaw: string | null
  status: string
  supplierChosen: string | null
  source: string | null
  priceDate: string | null
  docLink: string | null
  responsible: string | null
  notes: string | null
  scenarioRaw: string | null
}

export interface RawQuote {
  sheetRow: number
  id: string
  packageRaw: string | null
  service: string
  supplier: string | null
  receivedAt: string | null
  amount: number | null
  includesTaxes: string | null
  freight: number | null
  statusRaw: string | null
  durationDays: number | null
  validity: string | null
  documentRef: string | null
  scope: string | null
  responsible: string | null
  nextAction: string | null
  followUp: string | null
  notes: string | null
}

export interface RawContract {
  sheetRow: number
  id: string
  packageRaw: string | null
  supplier: string | null
  object: string | null
  originalAmount: number | null
  additives: number | null
  measured: number | null
  paid: number | null
  signedAt: string | null
  startAt: string | null
  endAt: string | null
  status: string | null
  documentRef: string | null
  notes: string | null
}

export interface RawRow {
  sheet: string
  row: number
  cells: Record<string, CellInfo>
}

export interface ParsedV4 {
  file: string
  sha256: string
  sheetNames: string[]
  rawRows: RawRow[]
  items: RawItem[]
  quotes: RawQuote[]
  contracts: RawContract[]
  milestones: Array<{ sheetRow: number; id: string; phase: string; title: string; plannedStart: string | null; plannedEnd: string | null; realStart: string | null; realEnd: string | null; progress: number | null; responsible: string | null; status: string | null }>
  scenarios: Array<{ sheetRow: number; name: string; directCost: number | null; comparability: string | null; notes: string | null }>
  pendencias: Array<{ sheetRow: number; title: string; info: string; document: string | null; statusRaw: string }>
  references: Array<{ sheet: string; sheetRow: number; label: string; value: number | null; valueText: string | null; unit: string | null; notes: string | null; source: string | null }>
  cashflow: Array<{ sheetRow: number; month: string; planned: number | null; realized: number | null }>
  validations: Record<string, string[]>
  formulaStats: Record<string, { formulas: number; withoutCache: number }>
  summaryCache: Array<{ sheetRow: number; group: string; cachedQuotes: number | null; cachedBase: number | null }>
  issues: Issue[]
}

export const SHEETS = {
  items: 'Orcamento detalhado',
  quotes: 'Propostas fornecedores',
  contracts: 'Contratos e medicoes',
  milestones: 'Cronograma marcos',
  cashflow: 'Fluxo mensal',
  panel: 'Painel executivo',
  bases: 'Bases e premissas',
  summary: 'Resumo por macroetapa',
  sources: 'Registro de fontes',
  research: 'Pesquisa aprofundada V2',
  scenarios: 'Cenarios estruturais V2',
  scope: 'Escopo hospital integral',
  limits: 'Abrangencia e limites',
  physical: 'V4 Base fisica e limites',
  matrix: 'V4 Matriz setores e custos',
  pendencias: 'V4 Pendencias criticas',
} as const

/**
 * Alguns geradores gravam relações com caminho absoluto (Target="/xl/...") e BOM,
 * que o exceljs não lê. Normalizamos uma CÓPIA em memória; o arquivo original não é alterado.
 */
async function normalizeXlsx(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf)
  let changed = false
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith('.rels') && name !== '[Content_Types].xml' && !name.endsWith('.xml')) continue
    const original = await zip.file(name)!.async('string')
    let xml = original.replace(/^\uFEFF/, '')
    if (name.endsWith('.rels')) {
      const baseDir = name.replace(/_rels\/[^/]+$/, '') // ex.: 'xl/' para xl/_rels/workbook.xml.rels
      xml = xml.replace(/Target="\/([^"]+)"/g, (_m, t: string) => {
        const rel = baseDir && t.startsWith(baseDir) ? t.slice(baseDir.length) : t
        return `Target="${rel}"`
      })
    }
    // Prefixo de namespace SpreadsheetML (<x:sheet>) → elemento sem prefixo, que o exceljs entende.
    const m = /xmlns:(\w+)="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/.exec(xml)
    if (m && !/xmlns="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/.test(xml)) {
      const px = m[1]
      xml = xml
        .replace(new RegExp(`<${px}:`, 'g'), '<')
        .replace(new RegExp(`</${px}:`, 'g'), '</')
        .replace(`xmlns:${px}=`, 'xmlns=')
    }
    if (xml !== original) {
      zip.file(name, xml)
      changed = true
    }
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer' }) : buf
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function readCell(cell: ExcelJS.Cell): CellInfo {
  const val = cell.value as unknown
  if (val === null || val === undefined) return { v: null }
  if (val instanceof Date) return { v: toIsoDate(val) }
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>
    if ('formula' in o || 'sharedFormula' in o) {
      const r = o.result
      const cached = r === undefined || r === null ? null : r instanceof Date ? toIsoDate(r) : typeof r === 'object' ? JSON.stringify(r) : (r as string | number | boolean)
      return { v: null, f: String(o.formula ?? o.sharedFormula), cached }
    }
    if ('richText' in o) return { v: (o.richText as Array<{ text: string }>).map((t) => t.text).join('') }
    if ('text' in o) return { v: String(o.text) }
    if ('error' in o) return { v: String(o.error) }
    return { v: JSON.stringify(o) }
  }
  return { v: val as string | number | boolean }
}

type HeaderMap = Record<string, number>

/** Mapeia cabeçalhos da linha 1 por nome normalizado. Alias: primeiro que corresponder. */
function mapHeaders(ws: ExcelJS.Worksheet, spec: Record<string, string[]>, issues: Issue[], required: string[]): HeaderMap {
  const headers: Array<[number, string]> = []
  ws.getRow(1).eachCell({ includeEmpty: false }, (c, col) => headers.push([col, norm(readCell(c).v)]))
  const map: HeaderMap = {}
  for (const [key, aliases] of Object.entries(spec)) {
    const hit = headers.find(([, h]) => aliases.some((a) => h === norm(a))) ?? headers.find(([, h]) => aliases.some((a) => h.startsWith(norm(a))))
    if (hit) map[key] = hit[0]
    else if (required.includes(key)) issues.push({ level: 'erro', code: 'cabecalho_ausente', sheet: ws.name, message: `Coluna obrigatória não encontrada: ${key} (${aliases.join(' / ')})` })
  }
  return map
}

class RowReader {
  constructor(
    private ws: ExcelJS.Worksheet,
    private h: HeaderMap,
    public row: number,
    private issues: Issue[],
  ) {}
  cell(key: string): CellInfo {
    const col = this.h[key]
    if (!col) return { v: null }
    return readCell(this.ws.getRow(this.row).getCell(col))
  }
  str(key: string): string | null {
    const v = this.cell(key).v
    if (v === null || v === '') return null
    return String(v).trim() || null
  }
  num(key: string): number | null {
    const c = this.cell(key)
    if (c.v === null || c.v === '') return null
    if (typeof c.v === 'number') return c.v
    const n = parseBRNumber(String(c.v))
    if (n === null) {
      this.issues.push({ level: 'alerta', code: 'valor_nao_numerico', sheet: this.ws.name, row: this.row, message: `Valor não numérico em “${key}”: ${JSON.stringify(c.v)} (mantido como ausente)` })
    }
    return n
  }
  date(key: string): string | null {
    const v = this.cell(key).v
    if (v === null || v === '') return null
    const s = String(v)
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
    return s
  }
}

function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export async function parseV4(file: string): Promise<ParsedV4> {
  const buf = readFileSync(file)
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await normalizeXlsx(buf)) as unknown as ArrayBuffer)
  const issues: Issue[] = []
  const sheetNames = wb.worksheets.map((w) => w.name)

  const get = (name: string): ExcelJS.Worksheet | null => {
    const ws = wb.worksheets.find((w) => norm(w.name) === norm(name)) ?? null
    if (!ws) issues.push({ level: 'erro', code: 'aba_ausente', sheet: name, message: `Aba não encontrada: ${name}` })
    return ws
  }

  // Cópia sem perda de todas as linhas + estatística de fórmulas sem cache
  const rawRows: RawRow[] = []
  const formulaStats: ParsedV4['formulaStats'] = {}
  for (const ws of wb.worksheets) {
    const st = { formulas: 0, withoutCache: 0 }
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      const cells: Record<string, CellInfo> = {}
      row.eachCell({ includeEmpty: false }, (c, col) => {
        const info = readCell(c)
        if (info.f !== undefined) {
          st.formulas++
          if (info.cached === null || info.cached === undefined) st.withoutCache++
        }
        if (info.v !== null || info.f !== undefined) cells[colLetter(col)] = info
      })
      if (Object.keys(cells).length) rawRows.push({ sheet: ws.name, row: r, cells })
    })
    formulaStats[ws.name] = st
    if (st.withoutCache > 0) {
      issues.push({ level: 'info', code: 'formula_sem_cache', sheet: ws.name, message: `${st.withoutCache} de ${st.formulas} fórmulas sem valor em cache — recalculado no app a partir dos dados primários.` })
    }
  }

  // Listas de validação (para detectar valores fora da lista)
  const validations: Record<string, string[]> = {}
  const isEmptyRow = (r: RowReader, keys: string[]) => keys.every((k) => r.cell(k).v === null)

  // ---------- Orçamento detalhado ----------
  const items: RawItem[] = []
  const wsI = get(SHEETS.items)
  if (wsI) {
    const h = mapHeaders(
      wsI,
      {
        code: ['Código'],
        group: ['Grupo'],
        categoryName: ['Macroetapa'],
        description: ['Pacote / serviço', 'Pacote', 'Serviço'],
        unit: ['Unid.', 'Unidade'],
        quantity: ['Qtde', 'Quantidade'],
        unitPrice: ['Preço base unit.', 'Preço unitário'],
        baseTotal: ['Orçado base R$'],
        quotedRef: ['Cotação referência R$'],
        contracted: ['Contratado R$'],
        estimate: ['Estimativa atual R$'],
        quoteStatus: ['Cotação'],
        status: ['Situação'],
        supplierChosen: ['Fornecedor escolhido'],
        source: ['Base / fonte', 'Fonte'],
        priceDate: ['Data referência'],
        docLink: ['Link documento'],
        responsible: ['Responsável'],
        notes: ['Observações'],
        scenario: ['Cenário estrutural'],
      },
      issues,
      ['code', 'group', 'categoryName', 'description', 'quantity', 'unitPrice', 'status'],
    )
    for (const key of ['quoteStatus', 'status', 'scenario']) {
      const col = h[key]
      if (!col) continue
      const dv = wsI.getRow(2).getCell(col).dataValidation as { type?: string; formulae?: string[] } | undefined
      if (dv?.type === 'list' && dv.formulae?.[0]) validations[`${SHEETS.items}:${key}`] = dv.formulae[0].replace(/^"|"$/g, '').split(',').map((s) => s.trim())
    }
    for (let r = 2; r <= wsI.rowCount; r++) {
      const rr = new RowReader(wsI, h, r, issues)
      const code = rr.str('code')
      if (!code) {
        if (!isEmptyRow(rr, ['description', 'quantity', 'unitPrice'])) issues.push({ level: 'alerta', code: 'linha_sem_codigo', sheet: wsI.name, row: r, message: 'Linha com dados mas sem código — ignorada' })
        continue
      }
      // Valores de fórmula em células de entrada (F, G, I, J) são sinalizados.
      for (const k of ['quantity', 'unitPrice', 'quotedRef', 'contracted']) {
        if (rr.cell(k).f) issues.push({ level: 'alerta', code: 'formula_em_entrada', sheet: wsI.name, row: r, message: `Fórmula em campo de entrada “${k}” (${rr.cell(k).f}) — ignorada` })
      }
      items.push({
        sheetRow: r,
        code,
        group: rr.str('group') ?? code.split('.')[0],
        categoryName: rr.str('categoryName') ?? '',
        description: rr.str('description') ?? '',
        unit: rr.str('unit'),
        quantity: rr.num('quantity'),
        unitPrice: rr.num('unitPrice'),
        quotedRef: rr.num('quotedRef'),
        contracted: rr.num('contracted'),
        quoteStatusRaw: rr.str('quoteStatus'),
        status: rr.str('status') ?? 'Não informado',
        supplierChosen: rr.str('supplierChosen'),
        source: rr.str('source'),
        priceDate: rr.date('priceDate'),
        docLink: rr.str('docLink'),
        responsible: rr.str('responsible'),
        notes: rr.str('notes'),
        scenarioRaw: rr.str('scenario'),
      })
    }
  }

  // ---------- Propostas ----------
  const quotes: RawQuote[] = []
  const wsQ = get(SHEETS.quotes)
  if (wsQ) {
    const h = mapHeaders(
      wsQ,
      {
        id: ['ID proposta'],
        packageRaw: ['Código pacote'],
        service: ['Serviço'],
        supplier: ['Fornecedor'],
        receivedAt: ['Data recebimento'],
        amount: ['Valor total R$'],
        includesTaxes: ['Inclui impostos?'],
        freight: ['Frete / viagem R$'],
        comparable: ['Valor comparável R$'],
        status: ['Status'],
        durationDays: ['Prazo execução (dias)'],
        validity: ['Validade proposta'],
        documentRef: ['Link arquivo / Drive', 'Link arquivo'],
        scope: ['Escopo e exclusões'],
        responsible: ['Responsável'],
        nextAction: ['Próxima ação'],
        followUp: ['Prazo follow-up'],
        notes: ['Observações'],
      },
      issues,
      ['id', 'packageRaw', 'service', 'amount', 'status'],
    )
    for (let r = 2; r <= wsQ.rowCount; r++) {
      const rr = new RowReader(wsQ, h, r, issues)
      const id = rr.str('id')
      if (!id) {
        if (!isEmptyRow(rr, ['service', 'supplier', 'amount'])) issues.push({ level: 'alerta', code: 'linha_sem_id', sheet: wsQ.name, row: r, message: 'Proposta sem ID — ignorada' })
        continue
      }
      quotes.push({
        sheetRow: r,
        id,
        packageRaw: rr.str('packageRaw'),
        service: rr.str('service') ?? '',
        supplier: rr.str('supplier'),
        receivedAt: rr.date('receivedAt'),
        amount: rr.num('amount'),
        includesTaxes: rr.str('includesTaxes'),
        freight: rr.num('freight'),
        statusRaw: rr.str('status'),
        durationDays: rr.num('durationDays'),
        validity: rr.date('validity'),
        documentRef: rr.str('documentRef'),
        scope: rr.str('scope'),
        responsible: rr.str('responsible'),
        nextAction: rr.str('nextAction'),
        followUp: rr.date('followUp'),
        notes: rr.str('notes'),
      })
    }
  }

  // ---------- Contratos e medições ----------
  const contracts: RawContract[] = []
  const wsC = get(SHEETS.contracts)
  if (wsC) {
    const h = mapHeaders(
      wsC,
      {
        id: ['Contrato ID'],
        packageRaw: ['Código pacote'],
        supplier: ['Fornecedor'],
        object: ['Objeto'],
        originalAmount: ['Valor original R$'],
        additives: ['Aditivos R$'],
        measured: ['Medido acumulado R$'],
        paid: ['Pago acumulado R$'],
        signedAt: ['Data assinatura'],
        startAt: ['Início'],
        endAt: ['Fim previsto'],
        status: ['Status'],
        documentRef: ['Link contrato'],
        notes: ['Observações'],
      },
      issues,
      ['id', 'packageRaw', 'originalAmount'],
    )
    for (let r = 2; r <= wsC.rowCount; r++) {
      const rr = new RowReader(wsC, h, r, issues)
      const keys = ['id', 'packageRaw', 'supplier', 'object', 'originalAmount', 'additives', 'measured', 'paid', 'signedAt']
      if (isEmptyRow(rr, keys)) continue
      const id = rr.str('id') ?? `CT-L${r}`
      if (!rr.str('id')) issues.push({ level: 'alerta', code: 'contrato_sem_id', sheet: wsC.name, row: r, message: `Contrato sem ID — chave gerada ${id}` })
      contracts.push({
        sheetRow: r,
        id,
        packageRaw: rr.str('packageRaw'),
        supplier: rr.str('supplier'),
        object: rr.str('object'),
        originalAmount: rr.num('originalAmount'),
        additives: rr.num('additives'),
        measured: rr.num('measured'),
        paid: rr.num('paid'),
        signedAt: rr.date('signedAt'),
        startAt: rr.date('startAt'),
        endAt: rr.date('endAt'),
        status: rr.str('status'),
        documentRef: rr.str('documentRef'),
        notes: rr.str('notes'),
      })
    }
  }

  // ---------- Cronograma ----------
  const milestones: ParsedV4['milestones'] = []
  const wsM = get(SHEETS.milestones)
  if (wsM) {
    const h = mapHeaders(
      wsM,
      { id: ['ID'], phase: ['Fase'], title: ['Marco / entrega'], plannedStart: ['Início previsto'], plannedEnd: ['Fim previsto'], realStart: ['Início real'], realEnd: ['Fim real'], progress: ['% avanço'], responsible: ['Responsável'], status: ['Situação'] },
      issues,
      ['id', 'title'],
    )
    for (let r = 2; r <= wsM.rowCount; r++) {
      const rr = new RowReader(wsM, h, r, issues)
      const id = rr.str('id')
      if (!id) continue
      milestones.push({ sheetRow: r, id, phase: rr.str('phase') ?? '', title: rr.str('title') ?? '', plannedStart: rr.date('plannedStart'), plannedEnd: rr.date('plannedEnd'), realStart: rr.date('realStart'), realEnd: rr.date('realEnd'), progress: rr.num('progress'), responsible: rr.str('responsible'), status: rr.str('status') })
    }
  }

  // ---------- Fluxo mensal ----------
  const cashflow: ParsedV4['cashflow'] = []
  const wsF = get(SHEETS.cashflow)
  if (wsF) {
    const h = mapHeaders(wsF, { month: ['Mês'], planned: ['Total planejado R$'], realized: ['Realizado R$'] }, issues, ['month'])
    for (let r = 2; r <= wsF.rowCount; r++) {
      const rr = new RowReader(wsF, h, r, issues)
      const month = rr.date('month')
      if (!month) continue
      // Total planejado é fórmula (soma dos grupos); somamos os grupos primários B..G.
      let planned: number | null = null
      for (let c = 2; c <= 7; c++) {
        const ci = readCell(wsF.getRow(r).getCell(c))
        if (typeof ci.v === 'number') planned = (planned ?? 0) + ci.v
      }
      cashflow.push({ sheetRow: r, month, planned, realized: rr.num('realized') })
    }
  }

  // ---------- Cenários estruturais ----------
  const scenarios: ParsedV4['scenarios'] = []
  const wsS = get(SHEETS.scenarios)
  if (wsS) {
    const h = mapHeaders(wsS, { name: ['Alternativa'], direct: ['Direto R$'], comparability: ['Comparabilidade'], notes: ['Observações'] }, issues, ['name', 'direct'])
    for (let r = 2; r <= wsS.rowCount; r++) {
      const rr = new RowReader(wsS, h, r, issues)
      const name = rr.str('name')
      if (!name || /^aviso/i.test(name)) continue
      scenarios.push({ sheetRow: r, name, directCost: rr.num('direct'), comparability: rr.str('comparability'), notes: rr.str('notes') })
    }
  }

  // ---------- Pendências ----------
  const pendencias: ParsedV4['pendencias'] = []
  const wsP = get(SHEETS.pendencias)
  if (wsP) {
    const h = mapHeaders(wsP, { title: ['Pacote crítico'], info: ['Informação necessária'], document: ['Documento base'], status: ['Status'] }, issues, ['title'])
    for (let r = 2; r <= wsP.rowCount; r++) {
      const rr = new RowReader(wsP, h, r, issues)
      const title = rr.str('title')
      if (!title) continue
      pendencias.push({ sheetRow: r, title, info: rr.str('info') ?? '', document: rr.str('document'), statusRaw: rr.str('status') ?? '' })
    }
  }

  // ---------- Referências (valores de pesquisa / premissas / base física) ----------
  const references: ParsedV4['references'] = []
  const refSheets: Array<[string, { label: string[]; value: string[]; unit?: string[]; notes: string[]; source?: string[] }]> = [
    [SHEETS.research, { label: ['PESQUISA APROFUNDADA'], value: ['Valor'], unit: ['Unidade / natureza'], notes: ['Observações / limitações'], source: ['Fonte'] }],
    [SHEETS.bases, { label: ['Referência'], value: ['Valor / informação'], unit: ['Tipo'], notes: ['Observações'], source: ['Fonte / URL'] }],
    [SHEETS.physical, { label: ['BASE FÍSICA CONFIRMADA'], value: ['Valor'], unit: ['Unidade'], notes: ['Fonte / critério'] }],
    [SHEETS.limits, { label: ['CONTROLE DE ABRANGÊNCIA'], value: ['Valor'], unit: ['Origem'], notes: ['Interpretação'] }],
  ]
  for (const [name, spec] of refSheets) {
    const ws = get(name)
    if (!ws) continue
    const h = mapHeaders(ws, spec as unknown as Record<string, string[]>, issues, ['label', 'value'])
    for (let r = 2; r <= ws.rowCount; r++) {
      const rr = new RowReader(ws, h, r, issues)
      const label = rr.str('label')
      if (!label) continue
      const c = rr.cell('value')
      let value: number | null = typeof c.v === 'number' ? c.v : null
      // Fórmulas simples (=B6*(1+B7), =B2*B11, =SUM(B3:B4)) são recalculadas aqui a partir das células primárias.
      if (c.f) value = evalSimpleFormula(c.f, ws)
      references.push({
        sheet: ws.name,
        sheetRow: r,
        label,
        value,
        valueText: typeof c.v === 'string' ? c.v : c.f ? `=${c.f}` : null,
        unit: rr.str('unit'),
        notes: rr.str('notes'),
        source: rr.str('source'),
      })
    }
  }

  // ---------- Resumo por macroetapa (para comparar cache × cálculo) ----------
  const summaryCache: ParsedV4['summaryCache'] = []
  const wsR = get(SHEETS.summary)
  if (wsR) {
    const h = mapHeaders(wsR, { group: ['Grupo'], base: ['Base R$'], quotes: ['Propostas'] }, issues, ['group'])
    for (let r = 2; r <= wsR.rowCount; r++) {
      const rr = new RowReader(wsR, h, r, issues)
      const group = rr.str('group')
      if (!group) continue
      const q = rr.cell('quotes')
      const b = rr.cell('base')
      summaryCache.push({ sheetRow: r, group, cachedQuotes: typeof q.cached === 'number' ? q.cached : null, cachedBase: typeof b.cached === 'number' ? b.cached : null })
    }
  }

  return { file, sha256, sheetNames, rawRows, items, quotes, contracts, milestones, scenarios, pendencias, references, cashflow, validations, formulaStats, summaryCache, issues }
}

/** Avalia fórmulas aritméticas simples com referências a células da mesma aba ou de outra aba. */
function evalSimpleFormula(f: string, ws: ExcelJS.Worksheet): number | null {
  const wb = ws.workbook
  const cellNum = (sheetName: string | null, addr: string): number | null => {
    const target = sheetName ? wb.worksheets.find((w) => w.name === sheetName) : ws
    if (!target) return null
    const info = readCell(target.getCell(addr.replace(/\$/g, '')))
    if (info.f) return evalSimpleFormula(info.f, target)
    return typeof info.v === 'number' ? info.v : null
  }
  let expr = f.replace(/^=/, '')
  const sum = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/i.exec(expr)
  if (sum) {
    let t: number | null = null
    for (let r = Number(sum[2]); r <= Number(sum[4]); r++) {
      const n = cellNum(null, `${sum[1]}${r}`)
      if (n !== null) t = (t ?? 0) + n
    }
    return t
  }
  let failed = false
  expr = expr.replace(/(?:'([^']+)'!|([A-Za-z0-9_]+)!)?(\$?[A-Z]{1,2}\$?\d+)/g, (_m, q1, q2, addr) => {
    const n = cellNum(q1 ?? q2 ?? null, addr)
    if (n === null) failed = true
    return String(n ?? 0)
  })
  if (failed || !/^[\d.+\-*/() ]+$/.test(expr)) return null
  try {
    // Expressão já validada como aritmética pura.
    const v = Function(`"use strict";return (${expr})`)() as number
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

export function mapConfidence(s: string | null): Confidence | null {
  const n = norm(s)
  if (!n) return null
  if (/alta/.test(n)) return 'alta'
  if (/media/.test(n)) return 'media'
  if (/baixa/.test(n)) return 'baixa'
  return null
}

export function mapPriceType(s: string | null): PriceType | null {
  const n = norm(s)
  if (!n) return null
  if (/sinapi/.test(n)) return 'sinapi'
  if (/contrat/.test(n)) return 'contrato'
  if (/verbal/.test(n)) return 'verbal'
  if (/parametric/.test(n)) return 'parametrica'
  if (/proposta|cotac/.test(n)) return 'proposta'
  if (/referenc/.test(n)) return 'referencia'
  return 'estimativa'
}
