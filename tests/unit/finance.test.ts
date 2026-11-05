import { describe, expect, it } from 'vitest'
import {
  abc,
  abcFromUnits,
  activeScenarioCost,
  buildCostUnits,
  categorySummaries,
  isQuoteComparable,
  referenceTotal,
  sumNullable,
  summarize,
  tracking,
} from '@/lib/finance'
import { clientView } from '@/lib/visibility'
import { contract, dataset, item, measurement, quote } from './fixtures'

const NONE = { activeScenario: null, includeMedicalEquipment: true } as const

describe('null × zero', () => {
  it('soma de conjunto sem valores é null, não 0', () => {
    expect(sumNullable([])).toBeNull()
    expect(sumNullable([null, null])).toBeNull()
    expect(sumNullable([null, 0])).toBe(0)
    expect(sumNullable([1.1, null, 2.2])).toBe(3.3)
  })
  it('item sem quantidade ou preço tem total null', () => {
    expect(referenceTotal({ quantity: null, unitPrice: 10 })).toBeNull()
    expect(referenceTotal({ quantity: 2, unitPrice: null })).toBeNull()
    expect(referenceTotal({ quantity: 0, unitPrice: 10 })).toBe(0)
    expect(referenceTotal({ quantity: 3, unitPrice: 33.333 })).toBe(100)
  })
  it('valor zero conhecido conta como precificado; ausente não', () => {
    const ds = dataset({ items: [item('01.001', { quantity: 0, unitPrice: 5 }), item('01.002')] })
    const s = summarize(ds, NONE)
    expect(s.estimateTotal).toBe(0)
    expect(s.coveredItems).toBe(1)
    expect(s.unpricedItems).toBe(1)
  })
  it('sem nenhum valor: custo conhecido, contratado e pago são null', () => {
    const s = summarize(dataset({ items: [item('01.001'), item('01.002')] }), NONE)
    expect(s.estimateTotal).toBeNull()
    expect(s.contractedTotal).toBeNull()
    expect(s.paidTotal).toBeNull()
    expect(s.coverage).toBe(0)
  })
})

describe('soma por categoria e custo conhecido', () => {
  const ds = dataset({
    items: [item('01.001', { quantity: 2, unitPrice: 100 }), item('01.002', { quantity: 1, unitPrice: 50 }), item('01.003'), item('19.001', { quantity: 1, unitPrice: 1000, costKind: 'equipamento_medico' })],
  })
  it('subtotal por categoria, contagens e % do conhecido', () => {
    const cats = categorySummaries(ds, NONE)
    const c01 = cats.find((c) => c.code === '01')!
    expect(c01.subtotal).toBe(250)
    expect(c01.itemCount).toBe(3)
    expect(c01.pricedCount).toBe(2)
    expect(c01.unpricedCount).toBe(1)
    expect(c01.pctOfKnown).toBeCloseTo(250 / 1250)
    expect(cats.find((c) => c.code === '06')!.subtotal).toBeNull()
  })
  it('custo conhecido com e sem equipamentos médicos', () => {
    const s = summarize(ds, NONE)
    expect(s.estimateTotal).toBe(1250)
    expect(s.estimateTotalExclMedicalEquipment).toBe(250)
    expect(s.knownCostPerM2).toBe(0.25)
    expect(s.coverage).toBeCloseTo(3 / 4)
  })
})

describe('cenários estruturais excludentes', () => {
  const items = [item('06.001', { scenario: 'concreto', quantity: 1, unitPrice: 100 }), item('06.003', { scenario: 'metalica', quantity: 1, unitPrice: 200 }), item('06.004', { scenario: 'lsf', quantity: 1, unitPrice: 50 }), item('06.007', { quantity: 1, unitPrice: 10 })]
  it('sem cenário ativo, nenhuma alternativa entra', () => {
    const s = summarize(dataset({ items }), NONE)
    expect(s.estimateTotal).toBe(10)
    expect(s.inScopeItems).toBe(1)
    expect(s.excludedByScenario).toBe(3)
  })
  it('apenas o cenário ativo entra — nunca a soma das três', () => {
    const s = summarize(dataset({ items }), { activeScenario: 'metalica', includeMedicalEquipment: true })
    expect(s.estimateTotal).toBe(210)
    expect(s.estimateTotal).not.toBe(360)
  })
  it('mais de um cenário ativo é erro', () => {
    const ds = dataset()
    ds.scenarios[0].isActive = true
    ds.scenarios[1].isActive = true
    expect(() => activeScenarioCost(ds)).toThrow(/excludentes/)
  })
})

describe('propostas concorrentes e camadas', () => {
  it('propostas concorrentes não são somadas: usa a de menor valor', () => {
    const ds = dataset({ items: [item('01.001')], quotes: [quote('Q1', ['01.001'], 300), quote('Q2', ['01.001'], 200), quote('Q3', ['01.001'], 250)] })
    const [u] = buildCostUnits(ds, NONE)
    expect(u.estimate).toBe(200)
    expect(u.chosenQuote?.id).toBe('Q2')
    expect(summarize(ds, NONE).estimateTotal).toBe(200)
  })
  it('proposta marcada como referência prevalece', () => {
    const ds = dataset({ items: [item('01.001')], quotes: [quote('Q1', ['01.001'], 300, { isReference: true }), quote('Q2', ['01.001'], 200)] })
    expect(buildCostUnits(ds, NONE)[0].estimate).toBe(300)
  })
  it('tarifas, mensais, opcionais, descartadas e vínculos divergentes ficam fora', () => {
    const qs = [
      quote('D', ['01.001'], 480, { amountKind: 'unitario', unitLabel: 'R$/dia' }),
      quote('M', ['01.001'], 12500, { amountKind: 'mensal' }),
      quote('O', ['01.001'], 15000, { amountKind: 'opcional', isOptional: true }),
      quote('X', ['01.001'], 1, { status: 'descartada' }),
      quote('V', ['01.001'], 4321, { linkStatus: 'divergente' }),
    ]
    qs.forEach((q) => expect(isQuoteComparable(q)).toBe(false))
    const s = summarize(dataset({ items: [item('01.001')], quotes: qs }), NONE)
    expect(s.estimateTotal).toBeNull()
    expect(s.quotesExcluded).toBe(5)
  })
  it('proposta global de vários pacotes vira um grupo sem rateio', () => {
    const ds = dataset({ items: [item('01.011'), item('01.012'), item('01.013')], quotes: [quote('G', ['01.011', '01.012'], 1000, { linkStatus: 'inferido' })] })
    const units = buildCostUnits(ds, NONE)
    expect(units).toHaveLength(2)
    const g = units.find((u) => u.itemCodes.length === 2)!
    expect(g.estimate).toBe(1000)
    expect(g.category).toBe('01')
    expect(summarize(ds, NONE).coveredItems).toBe(2)
  })
  it('contrato prevalece sobre proposta e referência; A+B+C nunca se somam', () => {
    const ds = dataset({
      items: [item('01.001', { quantity: 1, unitPrice: 100 })],
      quotes: [quote('Q', ['01.001'], 120)],
      contracts: [contract('C1', ['01.001'], 110, 5)],
      measurements: [measurement('C1', 50, 40)],
    })
    const s = summarize(ds, NONE)
    expect(s.estimateTotal).toBe(115)
    expect(s.referenceTotal).toBe(100)
    expect(s.contractedTotal).toBe(115)
    expect(s.paidTotal).toBe(40)
    expect(s.estimateBySource).toEqual({ contrato: 115, proposta: null, referencia: null })
    const t = tracking(buildCostUnits(ds, NONE))
    expect(t.rows[0].estimated).toBe(120)
    expect(t.rows[0].diff).toBe(-5)
  })
  it('proposta só não vira contratado', () => {
    const s = summarize(dataset({ items: [item('01.001')], quotes: [quote('Q', ['01.001'], 999, { status: 'aprovada' })] }), NONE)
    expect(s.contractedTotal).toBeNull()
    expect(s.estimateTotal).toBe(999)
  })
})

describe('curva ABC', () => {
  it('classifica A/B/C pelo acumulado anterior e exclui nulos', () => {
    const r = abc([
      { key: 'a', label: 'a', value: 70 },
      { key: 'b', label: 'b', value: 15 },
      { key: 'c', label: 'c', value: 10 },
      { key: 'd', label: 'd', value: 5 },
      { key: 'n', label: 'n', value: null },
    ])
    expect(r.total).toBe(100)
    expect(r.pricedEntries).toBe(4)
    expect(r.totalEntries).toBe(5)
    expect(r.rows.map((x) => x.cls)).toEqual(['A', 'A', 'B', 'C'])
    expect(r.rows.map((x) => x.cumPct)).toEqual([0.7, 0.85, 0.95, 1])
    expect(r.rows[0].pct).toBe(0.7)
  })
  it('sem valores: ranking vazio e total null', () => {
    const r = abc([{ key: 'x', label: 'x', value: null }])
    expect(r.rows).toEqual([])
    expect(r.total).toBeNull()
  })
  it('modo macroetapas agrega por categoria e base de referência ignora propostas', () => {
    const ds = dataset({ items: [item('01.001', { quantity: 1, unitPrice: 10 }), item('19.001')], quotes: [quote('Q', ['19.001'], 90)] })
    const units = buildCostUnits(ds, NONE)
    const cats = abcFromUnits(units, ds.categories, 'categorias', 'estimativa')
    expect(cats.rows.map((r) => [r.key, r.value])).toEqual([['19', 90], ['01', 10]])
    const ref = abcFromUnits(units, ds.categories, 'itens', 'referencia')
    expect(ref.rows.map((r) => r.key)).toEqual(['01.001'])
  })
})

describe('propostas internas ARTO (gerenciamento de obra)', () => {
  it('nunca entram no orçamento, mesmo com valor global', () => {
    const ds = dataset({ items: [item('03.001')], quotes: [quote('G', ['03.001'], 50000, { isInternal: true })] })
    expect(isQuoteComparable(ds.quotes[0])).toBe(false)
    expect(summarize(ds, NONE).estimateTotal).toBeNull()
  })
  it('visão do cliente remove a proposta e textos que citam o fornecedor', () => {
    const ds = dataset({
      items: [item('03.001', { source: 'Gerenciadora Alfa: valor mensal verbal', notes: 'ok' }), item('01.001', { source: 'Projeto base' })],
      quotes: [quote('G', ['03.001'], 1, { isInternal: true, supplier: 'Gerenciadora Alfa Ltda' }), quote('P', ['01.001'], 2)],
      pendencias: [
        { id: 'g', title: 'Gerenciamento', info: '', document: null, statusRaw: '', groups: ['03'], sheetRow: 1 },
        { id: 'f', title: 'Fundações', info: '', document: null, statusRaw: '', groups: ['05'], sheetRow: 2 },
      ],
    })
    const c = clientView(ds)
    expect(c.quotes.map((q) => q.id)).toEqual(['P'])
    expect(c.items[0].source).toBeNull()
    expect(c.items[0].notes).toBe('ok')
    expect(c.items[1].source).toBe('Projeto base')
    expect(c.pendencias.map((p) => p.id)).toEqual(['f'])
    expect(ds.quotes).toHaveLength(2) // original intacto
  })
})
