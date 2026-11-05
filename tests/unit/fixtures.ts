/**
 * Dados SINTÉTICOS apenas para testes — não representam preços reais e nunca são carregados pelo app.
 */
import type { Contract, Dataset, Item, Measurement, Quote } from '@/lib/types'

export function item(code: string, over: Partial<Item> = {}): Item {
  const group = code.split('.')[0]
  return {
    code,
    group,
    categoryName: `Grupo ${group}`,
    description: `Pacote ${code}`,
    unit: 'serv',
    quantity: null,
    unitPrice: null,
    priceType: null,
    priceDate: null,
    source: null,
    confidence: null,
    status: 'Não iniciado',
    quoteStatusRaw: 'Não cotado',
    supplierChosen: null,
    docLink: null,
    responsible: null,
    notes: null,
    scenario: 'base',
    scenarioInferred: false,
    costKind: 'direto',
    sheetRow: null,
    edited: [],
    ...over,
  }
}

export function quote(id: string, itemCodes: string[], amount: number | null, over: Partial<Quote> = {}): Quote {
  return {
    id,
    packageRaw: itemCodes[0] ?? null,
    itemCodes,
    linkStatus: 'ok',
    linkNote: null,
    service: `Serviço ${id}`,
    supplier: `Fornecedor ${id}`,
    receivedAt: null,
    amount,
    amountKind: amount === null ? 'sem_valor' : 'global',
    unitLabel: null,
    includesTaxes: null,
    freight: null,
    status: 'recebida',
    statusRaw: null,
    isVerbal: false,
    isOptional: false,
    isReference: false,
    durationDays: null,
    validity: null,
    documentRef: null,
    scope: null,
    responsible: null,
    nextAction: null,
    followUp: null,
    notes: null,
    sheetRow: null,
    edited: [],
    ...over,
  }
}

export function contract(id: string, itemCodes: string[], amount: number | null, additives: number | null = null): Contract {
  return { id, itemCodes, quoteId: null, supplier: null, object: null, originalAmount: amount, additives, signedAt: null, startAt: null, endAt: null, status: null, documentRef: null, notes: null, origin: 'manual', sheetRow: null }
}

export function measurement(contractId: string, measured: number | null, paid: number | null): Measurement {
  return { id: `${contractId}-${measured}-${paid}`, contractId, period: '2027-01', measured, paid, origin: 'manual' }
}

export function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    project: { id: 'p', name: 'Teste', fullName: '', location: '', areaM2: 1000, groundFloorM2: null, upperFloorM2: null, landM2: null, beds: null, version: 't', sourceFile: 't.xlsx', importedAt: null, baseDate: null },
    categories: [
      { code: '01', name: 'Projetos', sortOrder: 1 },
      { code: '06', name: 'Estrutura', sortOrder: 6 },
      { code: '19', name: 'Equipamentos', sortOrder: 19 },
    ],
    items: [],
    quotes: [],
    contracts: [],
    measurements: [],
    scenarios: [
      { id: 'concreto', name: 'Concreto', isActive: false, directCost: 100, comparability: null, notes: null, sheetRow: 2 },
      { id: 'metalica', name: 'Metálica', isActive: false, directCost: 200, comparability: null, notes: null, sheetRow: 3 },
      { id: 'lsf', name: 'LSF', isActive: false, directCost: 50, comparability: null, notes: null, sheetRow: 4 },
    ],
    pendencias: [],
    milestones: [],
    references: [],
    ...over,
  }
}
