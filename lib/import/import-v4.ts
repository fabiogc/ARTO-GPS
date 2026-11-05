/**
 * Normalização (pura) + aplicação idempotente no banco.
 * Chaves estáveis: código do pacote, ID da proposta, ID do contrato, código do grupo, slug da pendência.
 * Reimportar o mesmo arquivo não altera nada. Edições manuais (tabela overrides) são preservadas;
 * se a planilha mudar um campo editado manualmente, gera-se um conflito para decisão explícita.
 */
import type { DatabaseSync } from 'node:sqlite'
import { tx, type Row } from '../db'
import { EDITABLE } from '../editable'
import type { AmountKind, LinkStatus, QuoteStatus, Scenario } from '../types'
import { type Issue, type ParsedV4, SHEETS, mapPriceType } from './parse-v4'
import {
  detectAmountKind,
  detectLinkDivergence,
  detectVerbal,
  inferCostKind,
  inferMultiPackages,
  inferScenario,
  norm,
  normalizeQuoteStatus,
  parseScenarioLabel,
  pendenciaGroups,
  slug,
} from './rules'

export const PROJECT_ID = 'hospital-caico'

export interface Normalized {
  tables: Record<string, Row[]>
  report: ImportReport
}

export interface ImportReport {
  source: { file: string; sha256: string; sheets: string[] }
  counts: Record<string, number>
  coverage: {
    items: number
    categories: number
    referencePriced: number
    referenceUnpriced: number
    itemsCoveredByComparableQuote: number
    itemsWithoutAnyValue: number
    quotesByKind: Record<string, number>
    quotesWithoutItem: Array<{ id: string; packageRaw: string | null; reason: string }>
    quotesNotSummed: Array<{ id: string; reason: string }>
  }
  sources: Array<{ source: string; kind: 'item' | 'proposta'; ref: string }>
  outOfValidation: Array<{ sheet: string; row: number; field: string; value: string; allowed: string[] }>
  duplicates: string[]
  divergences: Array<{ code: string; message: string; sheet?: string; row?: number }>
  legacyDiff: null | { compared: number; differences: Array<{ id: string; field: string; legacy: unknown; v4: unknown }>; onlyLegacy: string[]; onlyV4: string[] }
  alerts: string[]
  issues: Issue[]
  sync?: Record<string, { inserted: number; updated: number; unchanged: number; removed: number }>
  conflicts?: Array<{ entity: string; key: string; field: string; manual: string | null; previousImport: string | null; newImport: string | null; action: string }>
}

type Legacy = { items?: Array<Record<string, unknown>>; proposals?: Array<Record<string, unknown>> } | null

const supplierId = (name: string) => `SUP-${slug(name)}`

export function normalizeV4(p: ParsedV4, legacy: Legacy = null): Normalized {
  const issues: Issue[] = [...p.issues]
  const divergences: ImportReport['divergences'] = []
  const alerts: string[] = []
  const duplicates: string[] = []

  // ---------- Projeto ----------
  const ref = (sheet: string, re: RegExp) => p.references.find((r) => r.sheet === sheet && re.test(norm(r.label)))
  const declaredArea = ref(SHEETS.bases, /area total construida/)?.value ?? ref(SHEETS.limits, /total construido/)?.value ?? null
  const summedArea = ref(SHEETS.physical, /total construido/)?.value ?? null
  const ground = ref(SHEETS.physical, /^terreo/)?.value ?? null
  const upper = ref(SHEETS.physical, /segundo pavimento/)?.value ?? null
  if (declaredArea !== null && summedArea !== null && Math.abs(declaredArea - summedArea) > 0.0005) {
    divergences.push({
      code: 'area_total',
      sheet: SHEETS.physical,
      message: `Área total declarada ${declaredArea} m² (memorial) ≠ soma dos pavimentos ${summedArea.toFixed(3)} m² (diferença ${(declaredArea - summedArea).toFixed(3)} m²). App usa o valor declarado do memorial.`,
    })
  }
  const approx = ref(SHEETS.bases, /area aproximada/)
  if (approx) divergences.push({ code: 'area_desatualizada', sheet: SHEETS.bases, row: approx.sheetRow, message: `“${approx.label}” = ${approx.valueText} está desatualizada frente à área revisada de ${declaredArea} m².` })

  const projects: Row[] = [
    {
      id: PROJECT_ID,
      name: 'Hospital Caicó',
      full_name: 'Hospital Geral de Caicó/RN',
      location: 'Caicó/RN',
      area_m2: declaredArea,
      ground_m2: ground,
      upper_m2: upper,
      land_m2: ref(SHEETS.physical, /^terreno/)?.value ?? null,
      beds: ref(SHEETS.physical, /leitos/)?.value ?? null,
      version: 'V4 — Quantificação integral',
      source_file: p.file.split('/').pop() ?? p.file,
      base_date: ref(SHEETS.physical, /data do projeto/)?.valueText ?? null,
    },
  ]

  // ---------- Categorias e itens ----------
  const categories = new Map<string, Row>()
  const itemRows: Row[] = []
  const seen = new Set<string>()
  const outOfValidation: ImportReport['outOfValidation'] = []
  const checkList = (field: 'quoteStatus' | 'status' | 'scenario', value: string | null, row: number) => {
    const allowed = p.validations[`${SHEETS.items}:${field}`]
    if (allowed && value && !allowed.includes(value)) outOfValidation.push({ sheet: SHEETS.items, row, field, value, allowed })
  }
  let scenarioInferredCount = 0
  for (const it of p.items) {
    if (seen.has(it.code)) {
      duplicates.push(`Código de pacote duplicado ${it.code} (linha ${it.sheetRow}) — mantida a primeira ocorrência`)
      continue
    }
    seen.add(it.code)
    if (!it.code.startsWith(`${it.group}.`)) divergences.push({ code: 'codigo_grupo', sheet: SHEETS.items, row: it.sheetRow, message: `Código ${it.code} não pertence ao grupo ${it.group}` })
    if (!categories.has(it.group)) categories.set(it.group, { code: it.group, project_id: PROJECT_ID, name: it.categoryName, sort_order: Number(it.group) || categories.size + 1 })
    else if (categories.get(it.group)!.name !== it.categoryName) divergences.push({ code: 'macroetapa_nome', sheet: SHEETS.items, row: it.sheetRow, message: `Grupo ${it.group} com nomes diferentes: “${categories.get(it.group)!.name}” × “${it.categoryName}”` })
    checkList('quoteStatus', it.quoteStatusRaw, it.sheetRow)
    checkList('status', it.status, it.sheetRow)
    checkList('scenario', it.scenarioRaw, it.sheetRow)
    let scenario: Scenario | null = parseScenarioLabel(it.scenarioRaw)
    let inferred = false
    if (!scenario) {
      scenario = inferScenario(it.group, it.description)
      inferred = scenario !== 'base'
      if (inferred) scenarioInferredCount++
    }
    itemRows.push({
      code: it.code,
      project_id: PROJECT_ID,
      category_code: it.group,
      category_name: it.categoryName,
      description: it.description,
      unit: it.unit,
      quantity: it.quantity,
      reference_unit_price: it.unitPrice,
      price_type: it.unitPrice !== null ? mapPriceType(it.source) ?? 'estimativa' : null,
      price_date: it.priceDate,
      source: it.source,
      confidence: null,
      status: it.status,
      quote_status_raw: it.quoteStatusRaw,
      supplier_chosen: it.supplierChosen,
      doc_link: it.docLink,
      responsible: it.responsible,
      notes: it.notes,
      scenario,
      scenario_inferred: inferred ? 1 : 0,
      cost_kind: inferCostKind(it.group, it.description),
      sheet_row: it.sheetRow,
    })
  }
  if (scenarioInferredCount) divergences.push({ code: 'cenario_vazio', sheet: SHEETS.items, message: `Coluna “Cenário estrutural” vazia em todos os pacotes; ${scenarioInferredCount} pacotes de alternativas estruturais tiveram cenário inferido pela descrição (revisar).` })
  const itemsByCode = new Map(p.items.map((i) => [i.code, i]))
  const itemList = [...itemsByCode.values()]

  // ---------- Fornecedores e propostas ----------
  const suppliers = new Map<string, Row>()
  const quoteRows: Row[] = []
  const quoteItems: Row[] = []
  const quotesWithoutItem: ImportReport['coverage']['quotesWithoutItem'] = []
  const quotesNotSummed: ImportReport['coverage']['quotesNotSummed'] = []
  const quoteSeen = new Set<string>()
  const comparableCoverage = new Set<string>()
  const kinds: Record<string, number> = {}

  // Cotação de referência informada na própria aba de orçamento (coluna I) → proposta sintética de referência.
  const synthetic = p.items
    .filter((i) => i.quotedRef !== null)
    .map((i) => ({ sheetRow: i.sheetRow, id: `REF-${i.code}`, packageRaw: i.code, service: i.description, supplier: i.supplierChosen, receivedAt: i.priceDate, amount: i.quotedRef, includesTaxes: null, freight: null, statusRaw: 'Cotação de referência (Orçamento detalhado)', durationDays: null, validity: null, documentRef: i.docLink, scope: null, responsible: i.responsible, nextAction: null, followUp: null, notes: i.notes, sheet: SHEETS.items }))

  for (const q of [...p.quotes.map((x) => ({ ...x, sheet: SHEETS.quotes })), ...synthetic]) {
    if (quoteSeen.has(q.id)) {
      duplicates.push(`ID de proposta duplicado ${q.id} (linha ${q.sheetRow}) — mantida a primeira ocorrência`)
      continue
    }
    quoteSeen.add(q.id)
    if (q.supplier && !suppliers.has(q.supplier)) suppliers.set(q.supplier, { id: supplierId(q.supplier), name: q.supplier, contact: null })
    const status: QuoteStatus = normalizeQuoteStatus(q.statusRaw)
    const { kind, unitLabel } = detectAmountKind(q.amount, [q.statusRaw, q.service], q.id, [q.scope])
    const amountKind: AmountKind = kind
    kinds[amountKind] = (kinds[amountKind] ?? 0) + 1
    let linkStatus: LinkStatus = 'sem_item'
    let linkNote: string | null = null
    let codes: string[] = []
    const pkg = q.packageRaw?.trim() ?? null
    if (pkg && itemsByCode.has(pkg)) {
      codes = [pkg]
      const div = detectLinkDivergence(q.service, itemsByCode.get(pkg)!)
      linkStatus = div ? 'divergente' : 'ok'
      linkNote = div
    } else if (pkg && /^multi$/i.test(pkg)) {
      codes = inferMultiPackages(q.service, itemList)
      linkStatus = codes.length ? 'inferido' : 'sem_item'
      linkNote = codes.length
        ? `Proposta global “MULTI”: vínculo inferido pelas disciplinas citadas → ${codes.join(', ')}. Tratada como um único pacote agrupado (sem rateio). Confirmar.`
        : 'Código MULTI sem disciplinas reconhecíveis.'
    } else {
      linkNote = pkg ? `Código de pacote “${pkg}” não existe no orçamento.` : 'Sem código de pacote.'
    }
    if (linkStatus === 'sem_item' || linkStatus === 'divergente') quotesWithoutItem.push({ id: q.id, packageRaw: pkg, reason: linkNote ?? '' })
    const isOptional = amountKind === 'opcional'
    const isVerbal = detectVerbal([q.statusRaw, q.service, q.documentRef, q.scope])
    const comparable = amountKind === 'global' && !isOptional && status !== 'descartada' && (linkStatus === 'ok' || linkStatus === 'inferido') && codes.length > 0
    if (comparable) codes.forEach((c) => comparableCoverage.add(c))
    else
      quotesNotSummed.push({
        id: q.id,
        reason:
          q.amount === null ? 'sem valor' : isOptional ? 'opcional' : amountKind === 'unitario' ? `tarifa ${unitLabel}` : amountKind === 'mensal' ? 'valor mensal' : linkStatus === 'divergente' ? 'vínculo divergente' : 'sem pacote',
      })
    quoteRows.push({
      id: q.id,
      package_raw: pkg,
      supplier_id: q.supplier ? supplierId(q.supplier) : null,
      service: q.service,
      received_at: q.receivedAt,
      amount: q.amount,
      amount_kind: amountKind,
      unit_label: unitLabel,
      includes_taxes: q.includesTaxes,
      freight: q.freight,
      status,
      status_raw: q.statusRaw,
      is_verbal: isVerbal ? 1 : 0,
      is_optional: isOptional ? 1 : 0,
      is_reference: q.id.startsWith('REF-') ? 1 : 0,
      duration_days: q.durationDays,
      validity: q.validity,
      document_ref: q.documentRef,
      scope: q.scope,
      responsible: q.responsible,
      next_action: q.nextAction,
      follow_up: q.followUp,
      notes: q.notes,
      link_status: linkStatus,
      link_note: linkNote,
      origin: 'planilha',
      sheet_row: q.sheetRow,
    })
    for (const c of codes) quoteItems.push({ quote_id: q.id, item_code: c })
    if (/equalizar outras? (\d+)/.test(norm(q.nextAction))) {
      alerts.push(`Proposta ${q.id} menciona “${q.nextAction}”: propostas concorrentes citadas não estão registradas na planilha.`)
    }
  }

  // Coluna “Cotação” do orçamento × propostas registradas
  const quotedCodes = new Set(quoteItems.map((r) => String(r.item_code)))
  for (const it of itemList) {
    if (quotedCodes.has(it.code) && norm(it.quoteStatusRaw) === 'nao cotado') {
      divergences.push({ code: 'cotacao_desatualizada', sheet: SHEETS.items, row: it.sheetRow, message: `${it.code}: coluna “Cotação” = “Não cotado”, mas há proposta registrada para o pacote.` })
    }
  }

  // ---------- Contratos ----------
  const contractRows: Row[] = []
  const contractItems: Row[] = []
  const measurementRows: Row[] = []
  for (const c of p.contracts) {
    const pkg = c.packageRaw?.trim() ?? null
    if (c.supplier && !suppliers.has(c.supplier)) suppliers.set(c.supplier, { id: supplierId(c.supplier), name: c.supplier, contact: null })
    contractRows.push({ id: c.id, quote_id: null, supplier_id: c.supplier ? supplierId(c.supplier) : null, object: c.object, contract_amount: c.originalAmount, additives: c.additives, approved_at: c.signedAt, start_at: c.startAt, end_at: c.endAt, status: c.status, document_ref: c.documentRef, notes: c.notes, origin: 'planilha', sheet_row: c.sheetRow })
    if (pkg && itemsByCode.has(pkg)) contractItems.push({ contract_id: c.id, item_code: pkg })
    else issues.push({ level: 'alerta', code: 'contrato_sem_pacote', sheet: SHEETS.contracts, row: c.sheetRow, message: `Contrato ${c.id} sem pacote válido (${pkg ?? 'vazio'})` })
    if (c.measured !== null || c.paid !== null) measurementRows.push({ id: `${c.id}-ACUM`, contract_id: c.id, period: 'Acumulado (planilha)', measured_amount: c.measured, paid_amount: c.paid, origin: 'planilha' })
  }
  for (const it of p.items.filter((i) => i.contracted !== null)) {
    const has = contractItems.some((ci) => ci.item_code === it.code)
    if (has) divergences.push({ code: 'contratado_duplicado', sheet: SHEETS.items, row: it.sheetRow, message: `${it.code}: valor em “Contratado R$” e contrato na aba de contratos — usado apenas o contrato.` })
    else {
      const id = `CT-ORC-${it.code}`
      contractRows.push({ id, quote_id: null, supplier_id: it.supplierChosen ? supplierId(it.supplierChosen) : null, object: it.description, contract_amount: it.contracted, additives: null, approved_at: null, start_at: null, end_at: null, status: 'Registrado no orçamento', document_ref: it.docLink, notes: 'Gerado a partir da coluna “Contratado R$” do Orçamento detalhado', origin: 'planilha', sheet_row: it.sheetRow })
      contractItems.push({ contract_id: id, item_code: it.code })
      if (it.supplierChosen && !suppliers.has(it.supplierChosen)) suppliers.set(it.supplierChosen, { id: supplierId(it.supplierChosen), name: it.supplierChosen, contact: null })
    }
  }

  // ---------- Cenários ----------
  const scenarioRows: Row[] = []
  for (const s of p.scenarios) {
    const id = parseScenarioLabel(s.name)
    if (!id || id === 'base' || id === 'a_definir') {
      issues.push({ level: 'alerta', code: 'cenario_desconhecido', sheet: SHEETS.scenarios, row: s.sheetRow, message: `Cenário não reconhecido: ${s.name}` })
      continue
    }
    scenarioRows.push({ id, project_id: PROJECT_ID, name: s.name, direct_cost: s.directCost, comparability: s.comparability, notes: s.notes, sheet_row: s.sheetRow })
  }

  // ---------- Pendências, cronograma, fluxo, referências ----------
  const pendRows: Row[] = p.pendencias.map((x) => ({ id: `PEND-${slug(x.title)}`, title: x.title, info: x.info, document: x.document, status_raw: x.statusRaw, groups_json: JSON.stringify(pendenciaGroups(x.title)), sheet_row: x.sheetRow }))
  const msRows: Row[] = p.milestones.map((m) => ({ id: m.id, phase: m.phase, title: m.title, planned_start: m.plannedStart, planned_end: m.plannedEnd, real_start: m.realStart, real_end: m.realEnd, progress: m.progress, responsible: m.responsible, status: m.status, sheet_row: m.sheetRow }))
  const cfRows: Row[] = p.cashflow.map((c) => ({ month: c.month, planned: c.planned, realized: c.realized, sheet_row: c.sheetRow }))
  const refRows: Row[] = p.references.map((r) => ({ id: `${slug(r.sheet)}-${r.sheetRow}`, sheet: r.sheet, sheet_row: r.sheetRow, label: r.label, value: r.value, value_text: r.valueText, unit: r.unit, notes: r.notes, source: r.source }))

  const sourceRows: Row[] = [
    ...itemRows.map((r) => ({ entity_type: 'item', entity_id: r.code, workbook_sheet: SHEETS.items, workbook_row: r.sheet_row, source_document: r.doc_link, notes: r.source })),
    ...quoteRows.map((r) => ({ entity_type: 'quote', entity_id: r.id, workbook_sheet: String(r.id).startsWith('REF-') ? SHEETS.items : SHEETS.quotes, workbook_row: r.sheet_row, source_document: r.document_ref, notes: null })),
    ...contractRows.map((r) => ({ entity_type: 'contract', entity_id: r.id, workbook_sheet: String(r.id).startsWith('CT-ORC-') ? SHEETS.items : SHEETS.contracts, workbook_row: r.sheet_row, source_document: r.document_ref, notes: null })),
    ...pendRows.map((r) => ({ entity_type: 'pendencia', entity_id: r.id, workbook_sheet: SHEETS.pendencias, workbook_row: r.sheet_row, source_document: r.document, notes: null })),
    ...scenarioRows.map((r) => ({ entity_type: 'scenario', entity_id: r.id, workbook_sheet: SHEETS.scenarios, workbook_row: r.sheet_row, source_document: null, notes: r.comparability })),
  ]
  const rawRows: Row[] = p.rawRows.map((r) => ({ sheet: r.sheet, row: r.row, data: JSON.stringify(r.cells) }))

  // ---------- Cache da planilha × cálculo ----------
  for (const s of p.summaryCache) {
    const computed = quoteRows.filter((q) => String(q.package_raw ?? '').startsWith(`${s.group}.`)).length
    const inGroup = new Set(quoteItems.filter((qi) => String(qi.item_code).startsWith(`${s.group}.`)).map((qi) => qi.quote_id)).size
    if ((s.cachedQuotes ?? 0) !== computed || computed !== inGroup) {
      divergences.push({
        code: 'resumo_propostas',
        sheet: SHEETS.summary,
        row: s.sheetRow,
        message: `Grupo ${s.group}: “Propostas” em cache = ${s.cachedQuotes ?? 'vazio/0'}; pelo código do pacote = ${computed}; com vínculo resolvido (inclui MULTI) = ${inGroup}.`,
      })
    }
  }
  const research = p.references.find((r) => r.sheet === SHEETS.research && /bdi e contingencia/.test(norm(r.label)))
  if (research?.value) alerts.push(`Subtotal parcial de pesquisa (${SHEETS.research}, linha ${research.sheetRow}) NÃO é orçamento global e não está distribuído pelos pacotes — exibido apenas como referência.`)
  const r46 = p.references.find((r) => r.sheet === SHEETS.research && /com referencia na pesquisa/.test(norm(r.label)))
  if (r46?.value) divergences.push({ code: 'pesquisa_sem_itens', sheet: SHEETS.research, row: r46.sheetRow, message: `Pesquisa cita ${r46.value} pacotes com referência, mas os preços individuais não estão na planilha — não importados como preço.` })
  const unverified = p.references.filter((r) => r.sheet === SHEETS.bases && /confirmar|mencionado/.test(norm(r.notes)) && r.valueText && /r\$/.test(norm(r.valueText)))
  for (const u of unverified) alerts.push(`Valor não comprovado em ${u.sheet} linha ${u.sheetRow} (“${u.label}”: ${u.valueText}) — não lançado como custo.`)
  if (contractRows.length === 0) alerts.push('Nenhum contrato registrado: contratado, medido e pago são exibidos como ausentes (não como R$ 0).')
  if (cfRows.every((c) => c.planned === null && c.realized === null)) alerts.push('Fluxo mensal sem valores lançados.')
  if (msRows.every((m) => !m.planned_start)) alerts.push('Cronograma de marcos sem datas — nenhuma data foi inventada.')

  // ---------- Diferenças em relação ao protótipo anterior (JSON) ----------
  let legacyDiff: ImportReport['legacyDiff'] = null
  if (legacy?.items) {
    const differences: Array<{ id: string; field: string; legacy: unknown; v4: unknown }> = []
    const v4 = new Map(p.items.map((i) => [i.code, i]))
    const pairs: Array<[string, keyof (typeof p.items)[number]]> = [['name', 'description'], ['category', 'categoryName'], ['unit', 'unit'], ['qty', 'quantity'], ['baseUnit', 'unitPrice'], ['quoted', 'quotedRef'], ['contracted', 'contracted'], ['status', 'status'], ['source', 'source'], ['notes', 'notes']]
    const blank = (x: unknown) => (x === '' || x === undefined ? null : x)
    for (const li of legacy.items) {
      const id = String(li.id)
      const vi = v4.get(id)
      if (!vi) continue
      for (const [lk, vk] of pairs) if (JSON.stringify(blank(li[lk])) !== JSON.stringify(blank(vi[vk]))) differences.push({ id, field: lk, legacy: li[lk], v4: vi[vk] })
    }
    for (const lp of legacy.proposals ?? []) {
      const q = p.quotes.find((x) => x.id === lp.id)
      if (!q) continue
      if ((lp.amount ?? null) !== q.amount) differences.push({ id: String(lp.id), field: 'amount', legacy: lp.amount, v4: q.amount })
      if ((lp.status ?? null) !== q.statusRaw) differences.push({ id: String(lp.id), field: 'status', legacy: lp.status, v4: q.statusRaw })
      if ((lp.code ?? null) !== q.packageRaw) differences.push({ id: String(lp.id), field: 'code', legacy: lp.code, v4: q.packageRaw })
    }
    const legacyIds = new Set([...legacy.items.map((i) => String(i.id)), ...(legacy.proposals ?? []).map((x) => String(x.id))])
    const v4Ids = new Set([...p.items.map((i) => i.code), ...p.quotes.map((q) => q.id)])
    legacyDiff = {
      compared: legacy.items.length + (legacy.proposals?.length ?? 0),
      differences,
      onlyLegacy: [...legacyIds].filter((x) => !v4Ids.has(x)),
      onlyV4: [...v4Ids].filter((x) => !legacyIds.has(x)),
    }
  }

  const referencePriced = itemRows.filter((r) => r.quantity !== null && r.reference_unit_price !== null).length
  const contracted = new Set(contractItems.map((c) => String(c.item_code)))
  const withValue = new Set([...comparableCoverage, ...contracted, ...itemRows.filter((r) => r.quantity !== null && r.reference_unit_price !== null).map((r) => String(r.code))])

  const sources: ImportReport['sources'] = [
    ...itemRows.filter((r) => r.source).map((r) => ({ source: String(r.source), kind: 'item' as const, ref: String(r.code) })),
    ...quoteRows.filter((r) => r.document_ref).map((r) => ({ source: String(r.document_ref), kind: 'proposta' as const, ref: String(r.id) })),
  ]

  const tables: Record<string, Row[]> = {
    projects,
    categories: [...categories.values()],
    items: itemRows,
    suppliers: [...suppliers.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    quotes: quoteRows,
    quote_items: quoteItems,
    contracts: contractRows,
    contract_items: contractItems,
    measurements: measurementRows,
    scenarios: scenarioRows,
    pendencias: pendRows,
    milestones: msRows,
    cashflow: cfRows,
    reference_values: refRows,
    source_records: sourceRows,
    sheet_rows: rawRows,
  }

  const report: ImportReport = {
    source: { file: p.file.split('/').pop() ?? p.file, sha256: p.sha256, sheets: p.sheetNames },
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    coverage: {
      items: itemRows.length,
      categories: categories.size,
      referencePriced,
      referenceUnpriced: itemRows.length - referencePriced,
      itemsCoveredByComparableQuote: comparableCoverage.size,
      itemsWithoutAnyValue: itemRows.length - withValue.size,
      quotesByKind: kinds,
      quotesWithoutItem,
      quotesNotSummed,
    },
    sources,
    outOfValidation,
    duplicates,
    divergences,
    legacyDiff,
    alerts,
    issues,
  }
  if (outOfValidation.length) divergences.push({ code: 'fora_da_lista', sheet: SHEETS.items, message: `${outOfValidation.length} valores fora da lista de validação da própria planilha (ver seção “Valores fora da lista”).` })
  return { tables, report }
}

// ---------------------------------------------------------------------------
// Aplicação no banco
// ---------------------------------------------------------------------------

const KEYS: Record<string, string[]> = {
  projects: ['id'],
  categories: ['code'],
  items: ['code'],
  suppliers: ['id'],
  quotes: ['id'],
  quote_items: ['quote_id', 'item_code'],
  contracts: ['id'],
  contract_items: ['contract_id', 'item_code'],
  measurements: ['id'],
  scenarios: ['id'],
  pendencias: ['id'],
  milestones: ['id'],
  cashflow: ['month'],
  reference_values: ['id'],
  source_records: ['entity_type', 'entity_id'],
  sheet_rows: ['sheet', 'row'],
}
/** Ordem respeita chaves estrangeiras (inserção) — remoção em ordem inversa. */
const ORDER = Object.keys(KEYS)
/** Tabelas cujas linhas "manuais" nunca são removidas pela importação. */
const HAS_ORIGIN = new Set(['quotes', 'contracts', 'measurements'])

export type Resolution = 'ask' | 'keep-manual' | 'accept-import'

const ENTITY_TABLE: Record<string, [string, string]> = { item: ['items', 'code'], quote: ['quotes', 'id'] }

const keyOf = (row: Row, cols: string[]) => cols.map((c) => String(row[c])).join('\u0001')
const same = (a: Row, b: Row, cols: string[]) => cols.every((c) => (a[c] ?? null) === (b[c] ?? null))

class DryRunRollback extends Error {}

/**
 * Aplica a importação. Com `dryRun`, executa tudo dentro da transação e desfaz no fim:
 * o relatório (sync/conflicts) mostra exatamente o que mudaria, sem alterar o banco.
 */
export function applyImport(db: DatabaseSync, n: Normalized, opts: { resolution?: Resolution; actor?: string; now?: string; dryRun?: boolean } = {}): ImportReport {
  const resolution = opts.resolution ?? 'ask'
  const now = opts.now ?? new Date().toISOString()
  const sync: NonNullable<ImportReport['sync']> = {}
  const conflicts: NonNullable<ImportReport['conflicts']> = []

  runImport(db, () => {
    // 1. Remoções (ordem inversa): linhas importadas que sumiram da planilha
    for (const table of [...ORDER].reverse()) {
      const cols = KEYS[table]
      const incoming = new Set(n.tables[table].map((r) => keyOf(r, cols)))
      const existing = db.prepare(`SELECT * FROM ${table}`).all() as Row[]
      let removed = 0
      for (const e of existing) {
        if (HAS_ORIGIN.has(table) && e.origin === 'manual') continue
        if (table === 'contract_items' && db.prepare("SELECT 1 FROM contracts WHERE id = ? AND origin = 'manual'").get(e.contract_id)) continue
        if (table === 'quote_items' && db.prepare("SELECT 1 FROM quotes WHERE id = ? AND origin = 'manual'").get(e.quote_id)) continue
        if (incoming.has(keyOf(e, cols))) continue
        // Dependentes manuais impedem remoção (ex.: contrato manual ligado a item removido)
        try {
          db.prepare(`DELETE FROM ${table} WHERE ${cols.map((c) => `${c} = ?`).join(' AND ')}`).run(...cols.map((c) => e[c]))
          removed++
        } catch (err) {
          n.report.issues.push({ level: 'alerta', code: 'remocao_bloqueada', message: `Não removido de ${table} (${keyOf(e, cols)}): ${(err as Error).message}` })
        }
      }
      sync[table] = { inserted: 0, updated: 0, unchanged: 0, removed }
    }
    // 2. Inserções/atualizações
    for (const table of ORDER) {
      const cols = KEYS[table]
      const rows = n.tables[table]
      const existing = new Map((db.prepare(`SELECT * FROM ${table}`).all() as Row[]).map((r) => [keyOf(r, cols), r]))
      for (const row of rows) {
        const allCols = Object.keys(row)
        const prev = existing.get(keyOf(row, cols))
        if (!prev) {
          db.prepare(`INSERT INTO ${table} (${allCols.join(',')}) VALUES (${allCols.map(() => '?').join(',')})`).run(...allCols.map((c) => row[c]))
          sync[table].inserted++
        } else if (!same(prev, row, allCols)) {
          const upd = allCols.filter((c) => !cols.includes(c))
          db.prepare(`UPDATE ${table} SET ${upd.map((c) => `${c} = ?`).join(', ')} WHERE ${cols.map((c) => `${c} = ?`).join(' AND ')}`).run(...upd.map((c) => row[c]), ...cols.map((c) => row[c]))
          sync[table].updated++
        } else sync[table].unchanged++
      }
    }
    // 3. Edições manuais × novos valores importados
    const overrides = db.prepare('SELECT * FROM overrides').all() as Row[]
    for (const o of overrides) {
      const [table, keyCol] = ENTITY_TABLE[String(o.entity_type)] ?? []
      const col = EDITABLE[String(o.entity_type)]?.[String(o.field)]
      if (!table || !col) continue
      const imported = db.prepare(`SELECT ${col} AS v FROM ${table} WHERE ${keyCol} = ?`).get(o.entity_key) as { v: string | number | null } | undefined
      const newImport = JSON.stringify(imported?.v ?? null)
      if (newImport === o.base_value) continue
      const entry = { entity: String(o.entity_type), key: String(o.entity_key), field: String(o.field), manual: o.value as string | null, previousImport: o.base_value as string | null, newImport, action: '' }
      if (resolution === 'accept-import') {
        db.prepare('DELETE FROM overrides WHERE entity_type = ? AND entity_key = ? AND field = ?').run(o.entity_type, o.entity_key, o.field)
        db.prepare('INSERT INTO audit_log (entity_type, entity_key, field, old_value, new_value, at, actor) VALUES (?,?,?,?,?,?,?)').run(o.entity_type, o.entity_key, o.field, o.value, newImport, now, `importação (${opts.actor ?? 'cli'})`)
        entry.action = 'valor da planilha aplicado; edição manual descartada'
      } else if (resolution === 'keep-manual') {
        db.prepare('UPDATE overrides SET base_value = ? WHERE entity_type = ? AND entity_key = ? AND field = ?').run(newImport, o.entity_type, o.entity_key, o.field)
        entry.action = 'edição manual mantida'
      } else {
        const open = db.prepare("SELECT id FROM import_conflicts WHERE entity_type = ? AND entity_key = ? AND field = ? AND status = 'pendente' AND new_import_value = ?").get(o.entity_type, o.entity_key, o.field, newImport)
        if (!open) db.prepare("INSERT INTO import_conflicts (entity_type, entity_key, field, manual_value, previous_import_value, new_import_value, status, detected_at) VALUES (?,?,?,?,?,?,'pendente',?)").run(o.entity_type, o.entity_key, o.field, o.value, o.base_value, newImport, now)
        entry.action = 'pendente — edição manual mantida até decisão'
      }
      conflicts.push(entry)
    }
    n.report.sync = sync
    n.report.conflicts = conflicts
    db.prepare('INSERT INTO import_runs (at, file, sha256, summary, report) VALUES (?,?,?,?,?)').run(now, n.report.source.file, n.report.source.sha256, JSON.stringify(sync), JSON.stringify(n.report))
    if (opts.dryRun) throw new DryRunRollback()
  })
  return n.report
}

function runImport(db: DatabaseSync, fn: () => void) {
  try {
    tx(db, fn)
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e
  }
}

export function reportToMarkdown(r: ImportReport): string {
  const L: string[] = []
  const c = r.coverage
  L.push(`# Relatório de importação — ${r.source.file}`, '', `SHA-256: \`${r.source.sha256}\` · ${r.source.sheets.length} abas`, '')
  L.push('## Cobertura', '')
  L.push(`- Pacotes: **${c.items}** em **${c.categories}** macroetapas`)
  L.push(`- Com orçamento de referência (qtde × preço): **${c.referencePriced}** · sem: **${c.referenceUnpriced}**`)
  L.push(`- Cobertos por proposta de valor global comparável: **${c.itemsCoveredByComparableQuote}**`)
  L.push(`- Sem nenhum valor (referência, proposta ou contrato): **${c.itemsWithoutAnyValue}**`)
  L.push(`- Propostas por tipo de valor: ${Object.entries(c.quotesByKind).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  L.push('', '### Propostas sem pacote associado / com vínculo divergente', '')
  for (const q of c.quotesWithoutItem) L.push(`- ${q.id} (${q.packageRaw ?? '—'}): ${q.reason}`)
  if (!c.quotesWithoutItem.length) L.push('- nenhuma')
  L.push('', '### Propostas não somadas em totais', '')
  for (const q of c.quotesNotSummed) L.push(`- ${q.id}: ${q.reason}`)
  L.push('', '## Alertas', '')
  for (const a of r.alerts) L.push(`- ${a}`)
  L.push('', '## Divergências', '')
  for (const d of r.divergences) L.push(`- [${d.code}]${d.sheet ? ` ${d.sheet}${d.row ? ` L${d.row}` : ''}` : ''}: ${d.message}`)
  L.push('', '## Valores fora da lista de validação', '')
  for (const o of r.outOfValidation) L.push(`- ${o.sheet} L${o.row} · ${o.field}: “${o.value}” (permitidos: ${o.allowed.join(', ')})`)
  if (!r.outOfValidation.length) L.push('- nenhum')
  L.push('', '## Duplicidades', '', ...(r.duplicates.length ? r.duplicates.map((d) => `- ${d}`) : ['- nenhuma']))
  L.push('', '## Fontes citadas', '')
  for (const s of r.sources) L.push(`- ${s.kind} ${s.ref}: ${s.source}`)
  if (r.legacyDiff) {
    L.push('', '## Protótipo anterior (JSON) × V4', '', `- Registros comparados: ${r.legacyDiff.compared}; diferenças: ${r.legacyDiff.differences.length}; só no JSON: ${r.legacyDiff.onlyLegacy.length}; só na V4: ${r.legacyDiff.onlyV4.length}`)
    for (const d of r.legacyDiff.differences.slice(0, 50)) L.push(`  - ${d.id}.${d.field}: JSON=${JSON.stringify(d.legacy)} · V4=${JSON.stringify(d.v4)}`)
  }
  L.push('', '## Contagens importadas', '', ...Object.entries(r.counts).map(([k, v]) => `- ${k}: ${v}`))
  if (r.sync) {
    L.push('', '## Sincronização', '', '| tabela | inseridas | atualizadas | inalteradas | removidas |', '|---|---|---|---|---|')
    for (const [t, s] of Object.entries(r.sync)) L.push(`| ${t} | ${s.inserted} | ${s.updated} | ${s.unchanged} | ${s.removed} |`)
  }
  if (r.conflicts?.length) {
    L.push('', '## Conflitos com edições manuais', '')
    for (const k of r.conflicts) L.push(`- ${k.entity} ${k.key}.${k.field}: manual=${k.manual} · planilha anterior=${k.previousImport} · planilha nova=${k.newImport} → ${k.action}`)
  }
  L.push('', '## Avisos técnicos', '', ...r.issues.map((i) => `- [${i.level}] ${i.sheet ?? ''}${i.row ? ` L${i.row}` : ''}: ${i.message}`))
  return L.join('\n') + '\n'
}
