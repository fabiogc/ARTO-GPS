/**
 * Núcleo financeiro (funções puras, testadas em tests/unit).
 *
 * Regras:
 *  - Três camadas separadas: (A) orçamento de referência, (B) propostas, (C) contratos/medições.
 *    Nunca somamos A+B+C. A "estimativa atual" de cada pacote escolhe UMA fonte:
 *    contrato > proposta de referência > orçamento-base (mesma lógica da coluna K da V4).
 *  - Propostas concorrentes não se somam: por unidade de custo usamos uma só
 *    (a marcada como referência, senão a de menor valor global comparável).
 *  - Tarifas (R$/dia, R$/mês), opcionais, propostas sem valor ou com vínculo divergente
 *    não entram em totais.
 *  - Alternativas estruturais são excludentes: só a do cenário ativo entra.
 *  - Ausência de dado = null. Soma de conjunto vazio = null.
 */
import type {
  Contract,
  Dataset,
  Item,
  Measurement,
  Quote,
  Scenario,
  StructuralScenario,
} from './types'

export interface CalcOptions {
  activeScenario: StructuralScenario | null
  includeMedicalEquipment: boolean
}

export const DEFAULT_OPTIONS: CalcOptions = { activeScenario: null, includeMedicalEquipment: true }

/** Soma que preserva ausência: todos null → null. */
export function sumNullable(values: Array<number | null | undefined>): number | null {
  let total: number | null = null
  for (const v of values) {
    if (v === null || v === undefined || Number.isNaN(v)) continue
    total = (total ?? 0) + v
  }
  return total === null ? null : round2(total)
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Camada A: quantidade × preço unitário; null se qualquer um faltar. */
export function referenceTotal(item: Pick<Item, 'quantity' | 'unitPrice'>): number | null {
  if (item.quantity === null || item.unitPrice === null) return null
  return round2(item.quantity * item.unitPrice)
}

export function isInScope(item: Pick<Item, 'scenario'>, active: StructuralScenario | null): boolean {
  const s: Scenario = item.scenario
  if (s === 'base' || s === 'a_definir') return true
  return s === active
}

/** Proposta pode representar o custo de um pacote? */
export function isQuoteComparable(q: Quote): boolean {
  return (
    !q.isInternal &&
    q.amountKind === 'global' &&
    q.amount !== null &&
    !q.isOptional &&
    q.status !== 'descartada' &&
    (q.linkStatus === 'ok' || q.linkStatus === 'inferido') &&
    q.itemCodes.length > 0
  )
}

export function quoteExclusionReason(q: Quote): string | null {
  if (q.isInternal) return 'Interna ARTO — base de escopo, fora do orçamento'
  if (q.amount === null) return 'Sem valor informado'
  if (q.status === 'descartada') return 'Proposta descartada'
  if (q.isOptional || q.amountKind === 'opcional') return 'Opcional — não somado'
  if (q.amountKind === 'unitario') return `Tarifa unitária${q.unitLabel ? ` (${q.unitLabel})` : ''} — total depende de quantidade`
  if (q.amountKind === 'mensal') return 'Valor mensal — total depende de prazo e escopo'
  if (q.linkStatus === 'divergente') return 'Escopo diverge do pacote vinculado'
  if (q.linkStatus === 'sem_item' || q.itemCodes.length === 0) return 'Sem pacote associado'
  return null
}

export function contractUpdatedAmount(c: Pick<Contract, 'originalAmount' | 'additives'>): number | null {
  if (c.originalAmount === null) return null
  return round2(c.originalAmount + (c.additives ?? 0))
}

export type EstimateSource = 'contrato' | 'proposta' | 'referencia'

export interface CostUnit {
  key: string
  itemCodes: string[]
  /** Código da macroetapa, ou 'MULTI' se a unidade cruza macroetapas (sem rateio). */
  category: string
  label: string
  reference: number | null
  referencePriced: number
  referencePartial: boolean
  candidates: Quote[]
  chosenQuote: Quote | null
  /** Propostas no mesmo pacote que não podem compor o custo (tarifas, opcionais, escopo diferente). */
  otherQuotes: Quote[]
  contracts: Contract[]
  contracted: number | null
  measured: number | null
  paid: number | null
  estimate: number | null
  estimateSource: EstimateSource | null
  /** Estimativa antes de contrato (proposta › referência), para comparar com contratado. */
  preContractEstimate: number | null
  isMedicalEquipment: boolean
}

class UnionFind {
  parent = new Map<string, string>()
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x)
    let p = this.parent.get(x)!
    if (p !== x) {
      p = this.find(p)
      this.parent.set(x, p)
    }
    return p
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra)
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

/**
 * Agrupa pacotes que só podem ser precificados juntos (ex.: proposta global de 4 disciplinas)
 * em "unidades de custo", evitando rateio arbitrário.
 */
export function buildCostUnits(
  ds: Pick<Dataset, 'items' | 'quotes' | 'contracts' | 'measurements'>,
  opts: CalcOptions = DEFAULT_OPTIONS,
): CostUnit[] {
  const inScope = ds.items.filter((i) => isInScope(i, opts.activeScenario))
  const byCode = new Map(inScope.map((i) => [i.code, i]))
  const uf = new UnionFind()
  for (const i of inScope) uf.find(i.code)

  const allInScope = (codes: string[]) => codes.length > 0 && codes.every((c) => byCode.has(c))
  const comparable = ds.quotes.filter((q) => isQuoteComparable(q) && allInScope(q.itemCodes))
  const contracts = ds.contracts.filter((c) => allInScope(c.itemCodes))

  for (const q of comparable) for (const c of q.itemCodes.slice(1)) uf.union(q.itemCodes[0], c)
  for (const k of contracts) for (const c of k.itemCodes.slice(1)) uf.union(k.itemCodes[0], c)

  const groups = new Map<string, string[]>()
  for (const i of inScope) {
    const r = uf.find(i.code)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(i.code)
  }

  const measByContract = new Map<string, Measurement[]>()
  for (const m of ds.measurements) {
    if (!measByContract.has(m.contractId)) measByContract.set(m.contractId, [])
    measByContract.get(m.contractId)!.push(m)
  }

  const units: CostUnit[] = []
  for (const codes of groups.values()) {
    codes.sort()
    const members = codes.map((c) => byCode.get(c)!)
    const set = new Set(codes)
    const touches = (list: string[]) => list.some((c) => set.has(c))
    const refs = members.map(referenceTotal)
    const reference = sumNullable(refs)
    const referencePriced = refs.filter((r) => r !== null).length

    const candidates = comparable.filter((q) => sameSet(q.itemCodes, codes))
    const otherQuotes = ds.quotes.filter((q) => touches(q.itemCodes) && !candidates.includes(q))
    const chosenQuote =
      candidates.find((q) => q.isReference) ??
      [...candidates].sort((a, b) => a.amount! - b.amount! || a.id.localeCompare(b.id))[0] ??
      null

    const unitContracts = contracts.filter((k) => touches(k.itemCodes))
    const contracted = sumNullable(unitContracts.map(contractUpdatedAmount))
    const meas = unitContracts.flatMap((k) => measByContract.get(k.id) ?? [])
    const measured = sumNullable(meas.map((m) => m.measured))
    const paid = sumNullable(meas.map((m) => m.paid))

    const preContractEstimate = chosenQuote?.amount ?? reference
    let estimate: number | null = null
    let estimateSource: EstimateSource | null = null
    if (contracted !== null) {
      estimate = contracted
      estimateSource = 'contrato'
    } else if (chosenQuote) {
      estimate = chosenQuote.amount
      estimateSource = 'proposta'
    } else if (reference !== null) {
      estimate = reference
      estimateSource = 'referencia'
    }

    const groupsInUnit = new Set(members.map((m) => m.group))
    units.push({
      key: codes.length === 1 ? codes[0] : `GRUPO:${codes.join('+')}`,
      itemCodes: codes,
      category: groupsInUnit.size === 1 ? members[0].group : 'MULTI',
      label:
        codes.length === 1
          ? members[0].description
          : `${chosenQuote?.service ?? 'Pacotes agrupados'} (${codes.length} pacotes)`,
      reference,
      referencePriced,
      referencePartial: referencePriced > 0 && referencePriced < codes.length,
      candidates,
      chosenQuote,
      otherQuotes,
      contracts: unitContracts,
      contracted,
      measured,
      paid,
      estimate,
      estimateSource,
      preContractEstimate,
      isMedicalEquipment: members.every((m) => m.costKind === 'equipamento_medico'),
    })
  }
  units.sort((a, b) => a.itemCodes[0].localeCompare(b.itemCodes[0]))
  return units
}

export interface Summary {
  totalItems: number
  inScopeItems: number
  excludedByScenario: number
  referenceTotal: number | null
  referencePricedItems: number
  estimateTotal: number | null
  estimateTotalExclMedicalEquipment: number | null
  estimateBySource: Record<EstimateSource, number | null>
  coveredItems: number
  unpricedItems: number
  coverage: number
  contractedTotal: number | null
  contractCount: number
  measuredTotal: number | null
  paidTotal: number | null
  quoteCount: number
  quotesExcluded: number
  /** custo/m² sobre o valor conhecido (sem equipamentos médicos) — só indicativo. */
  knownCostPerM2: number | null
  medicalEquipmentItems: number
}

export function summarize(ds: Dataset, opts: CalcOptions = DEFAULT_OPTIONS, units = buildCostUnits(ds, opts)): Summary {
  const inScope = ds.items.filter((i) => isInScope(i, opts.activeScenario))
  const covered = units.filter((u) => u.estimate !== null)
  const coveredItems = covered.reduce((n, u) => n + u.itemCodes.length, 0)
  const bySource = (s: EstimateSource) => sumNullable(covered.filter((u) => u.estimateSource === s).map((u) => u.estimate))
  const estimateExcl = sumNullable(covered.filter((u) => !u.isMedicalEquipment).map((u) => u.estimate))
  const estimateAll = sumNullable(covered.map((u) => u.estimate))
  const measAll = ds.measurements
  const area = ds.project.areaM2
  return {
    totalItems: ds.items.length,
    inScopeItems: inScope.length,
    excludedByScenario: ds.items.length - inScope.length,
    referenceTotal: sumNullable(inScope.map(referenceTotal)),
    referencePricedItems: inScope.filter((i) => referenceTotal(i) !== null).length,
    estimateTotal: opts.includeMedicalEquipment ? estimateAll : estimateExcl,
    estimateTotalExclMedicalEquipment: estimateExcl,
    estimateBySource: { contrato: bySource('contrato'), proposta: bySource('proposta'), referencia: bySource('referencia') },
    coveredItems,
    unpricedItems: inScope.length - coveredItems,
    coverage: inScope.length === 0 ? 0 : coveredItems / inScope.length,
    // Contratos são dinheiro comprometido: contam sempre, independentemente do cenário.
    contractedTotal: sumNullable(ds.contracts.map(contractUpdatedAmount)),
    contractCount: ds.contracts.length,
    measuredTotal: sumNullable(measAll.map((m) => m.measured)),
    paidTotal: sumNullable(measAll.map((m) => m.paid)),
    quoteCount: ds.quotes.length,
    quotesExcluded: ds.quotes.filter((q) => !isQuoteComparable(q)).length,
    knownCostPerM2: estimateExcl !== null && area ? round2(estimateExcl / area) : null,
    medicalEquipmentItems: inScope.filter((i) => i.costKind === 'equipamento_medico').length,
  }
}

export interface CategorySummary {
  code: string
  name: string
  sortOrder: number
  itemCount: number
  inScopeCount: number
  pricedCount: number
  unpricedCount: number
  subtotal: number | null
  referenceSubtotal: number | null
  pctOfKnown: number | null
  quoteCount: number
}

export function categorySummaries(ds: Dataset, opts: CalcOptions = DEFAULT_OPTIONS, units = buildCostUnits(ds, opts)): CategorySummary[] {
  const known = sumNullable(units.map((u) => u.estimate))
  return ds.categories.map((cat) => {
    const items = ds.items.filter((i) => i.group === cat.code)
    const inScope = items.filter((i) => isInScope(i, opts.activeScenario))
    const catUnits = units.filter((u) => u.category === cat.code)
    const priced = catUnits.filter((u) => u.estimate !== null).reduce((n, u) => n + u.itemCodes.length, 0)
    const subtotal = sumNullable(catUnits.map((u) => u.estimate))
    const codes = new Set(items.map((i) => i.code))
    return {
      code: cat.code,
      name: cat.name,
      sortOrder: cat.sortOrder,
      itemCount: items.length,
      inScopeCount: inScope.length,
      pricedCount: priced,
      unpricedCount: inScope.length - priced,
      subtotal,
      referenceSubtotal: sumNullable(inScope.map(referenceTotal)),
      pctOfKnown: subtotal !== null && known ? subtotal / known : null,
      quoteCount: ds.quotes.filter((q) => q.itemCodes.some((c) => codes.has(c))).length,
    }
  })
}

export type AbcClass = 'A' | 'B' | 'C'
export interface AbcRow {
  key: string
  label: string
  value: number
  pct: number
  cumPct: number
  cls: AbcClass
  rank: number
}
export interface AbcResult {
  rows: AbcRow[]
  total: number | null
  /** Quantas entradas tinham valor conhecido / quantas existiam. */
  pricedEntries: number
  totalEntries: number
}

/**
 * Curva ABC. Entradas com valor null são excluídas do ranking (mas contam no denominador de cobertura).
 * Classe: A enquanto o acumulado ANTERIOR < 80% (o item que cruza 80% é A); B até 95%; C o restante.
 */
export function abc(entries: Array<{ key: string; label: string; value: number | null }>): AbcResult {
  const priced = entries.filter((e): e is { key: string; label: string; value: number } => e.value !== null)
  const total = sumNullable(priced.map((e) => e.value))
  const sorted = [...priced].sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
  let cum = 0
  const rows: AbcRow[] = sorted.map((e, i) => {
    const prev = total ? cum / total : 0
    cum += e.value
    const cls: AbcClass = prev < 0.8 ? 'A' : prev < 0.95 ? 'B' : 'C'
    return {
      key: e.key,
      label: e.label,
      value: e.value,
      pct: total ? e.value / total : 0,
      cumPct: total ? cum / total : 0,
      cls,
      rank: i + 1,
    }
  })
  return { rows, total, pricedEntries: priced.length, totalEntries: entries.length }
}

export type AbcBase = 'estimativa' | 'referencia'
export type AbcMode = 'itens' | 'categorias'

export function abcFromUnits(units: CostUnit[], categories: Dataset['categories'], mode: AbcMode, base: AbcBase): AbcResult {
  const val = (u: CostUnit) => (base === 'estimativa' ? u.estimate : u.reference)
  if (mode === 'itens') {
    return abc(units.map((u) => ({ key: u.key, label: u.label, value: val(u) })))
  }
  const names = new Map(categories.map((c) => [c.code, c.name]))
  const keys = [...categories.map((c) => c.code), ...(units.some((u) => u.category === 'MULTI') ? ['MULTI'] : [])]
  return abc(
    keys.map((k) => ({
      key: k,
      label: k === 'MULTI' ? 'Pacotes multi-etapa (sem rateio)' : `${k} · ${names.get(k)}`,
      value: sumNullable(units.filter((u) => u.category === k).map(val)),
    })),
  )
}

export interface TrackingRow {
  unit: CostUnit
  estimated: number | null
  contracted: number | null
  measured: number | null
  paid: number | null
  /** contratado − estimado (só quando ambos existem). */
  diff: number | null
}

export function tracking(units: CostUnit[]): { rows: TrackingRow[]; totals: { estimated: number | null; contracted: number | null; measured: number | null; paid: number | null; diff: number | null; comparablePairs: number } } {
  const rows = units
    .filter((u) => u.preContractEstimate !== null || u.contracted !== null)
    .map((u) => ({
      unit: u,
      estimated: u.preContractEstimate,
      contracted: u.contracted,
      measured: u.measured,
      paid: u.paid,
      diff: u.preContractEstimate !== null && u.contracted !== null ? round2(u.contracted - u.preContractEstimate) : null,
    }))
  return {
    rows,
    totals: {
      estimated: sumNullable(rows.map((r) => r.estimated)),
      contracted: sumNullable(rows.map((r) => r.contracted)),
      measured: sumNullable(rows.map((r) => r.measured)),
      paid: sumNullable(rows.map((r) => r.paid)),
      diff: sumNullable(rows.map((r) => r.diff)),
      comparablePairs: rows.filter((r) => r.diff !== null).length,
    },
  }
}

/** Cenários estruturais: nunca somados; retorna apenas o ativo. */
export function activeScenarioCost(ds: Pick<Dataset, 'scenarios'>): { id: StructuralScenario; directCost: number | null } | null {
  const active = ds.scenarios.filter((s) => s.isActive)
  if (active.length > 1) throw new Error('Mais de um cenário estrutural ativo — cenários são mutuamente excludentes')
  return active[0] ? { id: active[0].id, directCost: active[0].directCost } : null
}

export function activeScenarioId(ds: Pick<Dataset, 'scenarios'>): StructuralScenario | null {
  return activeScenarioCost(ds)?.id ?? null
}
