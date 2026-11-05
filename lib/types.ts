// Tipos de domínio. Valores monetários ausentes são SEMPRE `null` — nunca 0.

export type Scenario = 'base' | 'concreto' | 'metalica' | 'lsf' | 'a_definir'
export type StructuralScenario = Exclude<Scenario, 'base' | 'a_definir'>
export type CostKind = 'direto' | 'equipamento_medico' | 'contingencia'
export type PriceType =
  | 'proposta'
  | 'contrato'
  | 'sinapi'
  | 'referencia'
  | 'parametrica'
  | 'verbal'
  | 'estimativa'
export type Confidence = 'alta' | 'media' | 'baixa'
export type QuoteStatus =
  | 'solicitada'
  | 'recebida'
  | 'em_analise'
  | 'negociacao'
  | 'aprovada'
  | 'contratada'
  | 'descartada'
/** global = preço total do escopo; unitario = tarifa (ex.: R$/dia); mensal = R$/mês; opcional; sem_valor. */
export type AmountKind = 'global' | 'unitario' | 'mensal' | 'opcional' | 'sem_valor'
/** ok = código do pacote existe; inferido = vínculo deduzido (ex.: MULTI); divergente = escopo não bate com o pacote; sem_item = sem pacote correspondente. */
export type LinkStatus = 'ok' | 'inferido' | 'divergente' | 'sem_item'

export interface Project {
  id: string
  name: string
  fullName: string
  location: string
  areaM2: number | null
  groundFloorM2: number | null
  upperFloorM2: number | null
  landM2: number | null
  beds: number | null
  version: string
  sourceFile: string
  importedAt: string | null
  baseDate: string | null
}

export interface Category {
  code: string
  name: string
  sortOrder: number
}

export interface Item {
  code: string
  group: string
  categoryName: string
  description: string
  unit: string | null
  quantity: number | null
  unitPrice: number | null
  priceType: PriceType | null
  priceDate: string | null
  source: string | null
  confidence: Confidence | null
  status: string
  quoteStatusRaw: string | null
  supplierChosen: string | null
  docLink: string | null
  responsible: string | null
  notes: string | null
  scenario: Scenario
  scenarioInferred: boolean
  costKind: CostKind
  sheetRow: number | null
  /** Campos com edição manual (override) aplicada. */
  edited: string[]
}

export interface Quote {
  id: string
  packageRaw: string | null
  itemCodes: string[]
  linkStatus: LinkStatus
  linkNote: string | null
  service: string
  supplier: string | null
  receivedAt: string | null
  amount: number | null
  amountKind: AmountKind
  unitLabel: string | null
  includesTaxes: string | null
  freight: number | null
  status: QuoteStatus
  statusRaw: string | null
  isVerbal: boolean
  isOptional: boolean
  isReference: boolean
  /** Proposta interna da ARTO (ex.: gerenciamento de obra): base de escopo, nunca orçamento; invisível ao cliente. */
  isInternal: boolean
  durationDays: number | null
  validity: string | null
  documentRef: string | null
  scope: string | null
  responsible: string | null
  nextAction: string | null
  followUp: string | null
  notes: string | null
  sheetRow: number | null
  edited: string[]
}

export interface Contract {
  id: string
  itemCodes: string[]
  quoteId: string | null
  supplier: string | null
  object: string | null
  originalAmount: number | null
  additives: number | null
  signedAt: string | null
  startAt: string | null
  endAt: string | null
  status: string | null
  documentRef: string | null
  notes: string | null
  origin: 'planilha' | 'manual'
  sheetRow: number | null
}

export interface Measurement {
  id: string
  contractId: string
  period: string
  measured: number | null
  paid: number | null
  origin: 'planilha' | 'manual'
}

export interface ScenarioDef {
  id: StructuralScenario
  name: string
  isActive: boolean
  directCost: number | null
  comparability: string | null
  notes: string | null
  sheetRow: number | null
}

export interface Pendencia {
  id: string
  title: string
  info: string
  document: string | null
  statusRaw: string
  groups: string[]
  sheetRow: number
}

export interface Milestone {
  id: string
  phase: string
  title: string
  plannedStart: string | null
  plannedEnd: string | null
  progress: number | null
  status: string | null
  sheetRow: number
}

export interface ReferenceValue {
  id: string
  sheet: string
  sheetRow: number
  label: string
  value: number | null
  valueText: string | null
  unit: string | null
  notes: string | null
  source: string | null
}

export interface AuditEntry {
  id: number
  entityType: string
  entityKey: string
  field: string
  oldValue: string | null
  newValue: string | null
  at: string
  actor: string
}

export interface SourceRecord {
  entityType: string
  entityKey: string
  sheet: string
  row: number
}

export interface Dataset {
  project: Project
  categories: Category[]
  items: Item[]
  quotes: Quote[]
  contracts: Contract[]
  measurements: Measurement[]
  scenarios: ScenarioDef[]
  pendencias: Pendencia[]
  milestones: Milestone[]
  references: ReferenceValue[]
}

export type Role = 'admin' | 'cliente'
