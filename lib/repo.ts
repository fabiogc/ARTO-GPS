/**
 * Acesso a dados: carrega o Dataset (valores importados + edições manuais) e grava edições com auditoria.
 */
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { defaultDbPath, openDb, tx, type Row } from './db'
import { EDITABLE } from './editable'
import type {
  AuditEntry,
  Confidence,
  Contract,
  CostKind,
  Dataset,
  Item,
  Measurement,
  Milestone,
  Pendencia,
  PriceType,
  Quote,
  QuoteStatus,
  ReferenceValue,
  Scenario,
  ScenarioDef,
  SourceRecord,
  StructuralScenario,
} from './types'

let cached: { path: string; db: DatabaseSync } | null = null

export function dbAvailable(path = defaultDbPath()): boolean {
  return existsSync(path)
}

export function getDb(): DatabaseSync {
  const path = defaultDbPath()
  if (cached?.path === path) return cached.db
  if (!existsSync(path)) throw new DataNotImportedError(path)
  cached = { path, db: openDb(path) }
  return cached.db
}

export class DataNotImportedError extends Error {
  constructor(public path: string) {
    super(`Banco não encontrado em ${path}. Rode "npm run import".`)
  }
}

const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

type OverrideMap = Map<string, Map<string, unknown>>
function loadOverrides(db: DatabaseSync, entity: string): OverrideMap {
  const m: OverrideMap = new Map()
  for (const o of db.prepare('SELECT entity_key, field, value FROM overrides WHERE entity_type = ?').all(entity) as Row[]) {
    const key = String(o.entity_key)
    if (!m.has(key)) m.set(key, new Map())
    m.get(key)!.set(String(o.field), o.value === null ? null : JSON.parse(String(o.value)))
  }
  return m
}

function apply<T extends object>(obj: T & { edited: string[] }, ov: Map<string, unknown> | undefined): T & { edited: string[] } {
  if (!ov) return obj
  for (const [field, value] of ov) {
    ;(obj as Record<string, unknown>)[field] = value
    obj.edited.push(field)
  }
  return obj
}

export function loadDataset(db: DatabaseSync = getDb()): Dataset {
  const p = db.prepare('SELECT * FROM projects LIMIT 1').get() as Row | undefined
  const lastRun = db.prepare('SELECT at FROM import_runs ORDER BY id DESC LIMIT 1').get() as Row | undefined
  const project = {
    id: s(p?.id) ?? 'hospital-caico',
    name: s(p?.name) ?? 'Hospital Caicó',
    fullName: s(p?.full_name) ?? '',
    location: s(p?.location) ?? '',
    areaM2: n(p?.area_m2),
    groundFloorM2: n(p?.ground_m2),
    upperFloorM2: n(p?.upper_m2),
    landM2: n(p?.land_m2),
    beds: n(p?.beds),
    version: s(p?.version) ?? '',
    sourceFile: s(p?.source_file) ?? '',
    importedAt: s(lastRun?.at),
    baseDate: s(p?.base_date),
  }
  const categories = (db.prepare('SELECT * FROM categories ORDER BY sort_order, code').all() as Row[]).map((r) => ({ code: String(r.code), name: String(r.name), sortOrder: Number(r.sort_order) }))
  const itemOv = loadOverrides(db, 'item')
  const items: Item[] = (db.prepare('SELECT * FROM items ORDER BY code').all() as Row[]).map((r) =>
    apply(
      {
        code: String(r.code),
        group: String(r.category_code),
        categoryName: s(r.category_name) ?? '',
        description: String(r.description),
        unit: s(r.unit),
        quantity: n(r.quantity),
        unitPrice: n(r.reference_unit_price),
        priceType: s(r.price_type) as PriceType | null,
        priceDate: s(r.price_date),
        source: s(r.source),
        confidence: s(r.confidence) as Confidence | null,
        status: s(r.status) ?? '',
        quoteStatusRaw: s(r.quote_status_raw),
        supplierChosen: s(r.supplier_chosen),
        docLink: s(r.doc_link),
        responsible: s(r.responsible),
        notes: s(r.notes),
        scenario: String(r.scenario) as Scenario,
        scenarioInferred: Number(r.scenario_inferred) === 1,
        costKind: String(r.cost_kind) as CostKind,
        sheetRow: n(r.sheet_row),
        edited: [] as string[],
      },
      itemOv.get(String(r.code)),
    ),
  )
  const suppliers = new Map((db.prepare('SELECT id, name FROM suppliers').all() as Row[]).map((r) => [String(r.id), String(r.name)]))
  const qItems = new Map<string, string[]>()
  for (const r of db.prepare('SELECT quote_id, item_code FROM quote_items ORDER BY item_code').all() as Row[]) {
    const k = String(r.quote_id)
    if (!qItems.has(k)) qItems.set(k, [])
    qItems.get(k)!.push(String(r.item_code))
  }
  const quoteOv = loadOverrides(db, 'quote')
  const quotes: Quote[] = (db.prepare('SELECT * FROM quotes ORDER BY sheet_row, id').all() as Row[]).map((r) =>
    apply(
      {
        id: String(r.id),
        packageRaw: s(r.package_raw),
        itemCodes: qItems.get(String(r.id)) ?? [],
        linkStatus: String(r.link_status) as Quote['linkStatus'],
        linkNote: s(r.link_note),
        service: s(r.service) ?? '',
        supplier: r.supplier_id ? suppliers.get(String(r.supplier_id)) ?? null : null,
        receivedAt: s(r.received_at),
        amount: n(r.amount),
        amountKind: String(r.amount_kind) as Quote['amountKind'],
        unitLabel: s(r.unit_label),
        includesTaxes: s(r.includes_taxes),
        freight: n(r.freight),
        status: String(r.status) as QuoteStatus,
        statusRaw: s(r.status_raw),
        isVerbal: Number(r.is_verbal) === 1,
        isOptional: Number(r.is_optional) === 1,
        isReference: Number(r.is_reference) === 1,
        durationDays: n(r.duration_days),
        validity: s(r.validity),
        documentRef: s(r.document_ref),
        scope: s(r.scope),
        responsible: s(r.responsible),
        nextAction: s(r.next_action),
        followUp: s(r.follow_up),
        notes: s(r.notes),
        sheetRow: n(r.sheet_row),
        edited: [] as string[],
      },
      quoteOv.get(String(r.id)),
    ),
  )
  const cItems = new Map<string, string[]>()
  for (const r of db.prepare('SELECT contract_id, item_code FROM contract_items ORDER BY item_code').all() as Row[]) {
    const k = String(r.contract_id)
    if (!cItems.has(k)) cItems.set(k, [])
    cItems.get(k)!.push(String(r.item_code))
  }
  const contracts: Contract[] = (db.prepare('SELECT * FROM contracts ORDER BY id').all() as Row[]).map((r) => ({
    id: String(r.id),
    itemCodes: cItems.get(String(r.id)) ?? [],
    quoteId: s(r.quote_id),
    supplier: r.supplier_id ? suppliers.get(String(r.supplier_id)) ?? null : null,
    object: s(r.object),
    originalAmount: n(r.contract_amount),
    additives: n(r.additives),
    signedAt: s(r.approved_at),
    startAt: s(r.start_at),
    endAt: s(r.end_at),
    status: s(r.status),
    documentRef: s(r.document_ref),
    notes: s(r.notes),
    origin: String(r.origin) as Contract['origin'],
    sheetRow: n(r.sheet_row),
  }))
  const measurements: Measurement[] = (db.prepare('SELECT * FROM measurements ORDER BY contract_id, period').all() as Row[]).map((r) => ({
    id: String(r.id),
    contractId: String(r.contract_id),
    period: String(r.period),
    measured: n(r.measured_amount),
    paid: n(r.paid_amount),
    origin: String(r.origin) as Measurement['origin'],
  }))
  const scenarios: ScenarioDef[] = (db.prepare('SELECT * FROM scenarios ORDER BY sheet_row').all() as Row[]).map((r) => ({
    id: String(r.id) as StructuralScenario,
    name: String(r.name),
    isActive: Number(r.is_active) === 1,
    directCost: n(r.direct_cost),
    comparability: s(r.comparability),
    notes: s(r.notes),
    sheetRow: n(r.sheet_row),
  }))
  const pendencias: Pendencia[] = (db.prepare('SELECT * FROM pendencias ORDER BY sheet_row').all() as Row[]).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    info: s(r.info) ?? '',
    document: s(r.document),
    statusRaw: s(r.status_raw) ?? '',
    groups: JSON.parse(String(r.groups_json)),
    sheetRow: Number(r.sheet_row),
  }))
  const milestones: Milestone[] = (db.prepare('SELECT * FROM milestones ORDER BY sheet_row').all() as Row[]).map((r) => ({
    id: String(r.id),
    phase: s(r.phase) ?? '',
    title: s(r.title) ?? '',
    plannedStart: s(r.planned_start),
    plannedEnd: s(r.planned_end),
    progress: n(r.progress),
    status: s(r.status),
    sheetRow: Number(r.sheet_row),
  }))
  const references: ReferenceValue[] = (db.prepare('SELECT * FROM reference_values ORDER BY sheet, sheet_row').all() as Row[]).map((r) => ({
    id: String(r.id),
    sheet: String(r.sheet),
    sheetRow: Number(r.sheet_row),
    label: String(r.label),
    value: n(r.value),
    valueText: s(r.value_text),
    unit: s(r.unit),
    notes: s(r.notes),
    source: s(r.source),
  }))
  return { project, categories, items, quotes, contracts, measurements, scenarios, pendencias, milestones, references }
}

export function sourceRecordsFor(entityType: string, key: string, db: DatabaseSync = getDb()): SourceRecord[] {
  return (db.prepare('SELECT * FROM source_records WHERE entity_type = ? AND entity_id = ?').all(entityType, key) as Row[]).map((r) => ({
    entityType: String(r.entity_type),
    entityKey: String(r.entity_id),
    sheet: String(r.workbook_sheet),
    row: Number(r.workbook_row),
  }))
}

export function auditFor(entityType: string, keys: string[], db: DatabaseSync = getDb()): AuditEntry[] {
  if (!keys.length) return []
  return (db.prepare(`SELECT * FROM audit_log WHERE entity_type = ? AND entity_key IN (${keys.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 100`).all(entityType, ...keys) as Row[]).map((r) => ({
    id: Number(r.id),
    entityType: String(r.entity_type),
    entityKey: String(r.entity_key),
    field: String(r.field),
    oldValue: s(r.old_value),
    newValue: s(r.new_value),
    at: String(r.at),
    actor: String(r.actor),
  }))
}

export function rawSheetRow(sheet: string, row: number, db: DatabaseSync = getDb()): Record<string, { v: unknown; f?: string }> | null {
  const r = db.prepare('SELECT data FROM sheet_rows WHERE sheet = ? AND row = ?').get(sheet, row) as Row | undefined
  return r ? JSON.parse(String(r.data)) : null
}

export function lastImportReport(db: DatabaseSync = getDb()): { at: string; report: import('./import/import-v4').ImportReport } | null {
  const r = db.prepare('SELECT at, report FROM import_runs ORDER BY id DESC LIMIT 1').get() as Row | undefined
  return r ? { at: String(r.at), report: JSON.parse(String(r.report)) } : null
}

export function openConflicts(db: DatabaseSync = getDb()) {
  return db.prepare("SELECT * FROM import_conflicts WHERE status = 'pendente' ORDER BY id").all() as Row[]
}

// ---------------------------------------------------------------------------
// Escrita (somente admin — verificado na camada de ação)
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString()

function audit(db: DatabaseSync, entity: string, key: string, field: string, oldV: unknown, newV: unknown, actor: string) {
  db.prepare('INSERT INTO audit_log (entity_type, entity_key, field, old_value, new_value, at, actor) VALUES (?,?,?,?,?,?,?)').run(entity, key, field, JSON.stringify(oldV ?? null), JSON.stringify(newV ?? null), now(), actor)
}

/**
 * Grava edição manual. Se o valor voltar a ser igual ao importado, remove o override.
 * `base_value` guarda o valor importado no momento da edição para detectar conflitos na reimportação.
 */
export function setOverrides(entity: 'item' | 'quote', key: string, changes: Record<string, unknown>, actor: string, db: DatabaseSync = getDb()): number {
  const table = entity === 'item' ? 'items' : 'quotes'
  const keyCol = entity === 'item' ? 'code' : 'id'
  const imported = db.prepare(`SELECT * FROM ${table} WHERE ${keyCol} = ?`).get(key) as Row | undefined
  if (!imported) throw new Error(`${entity} ${key} não encontrado`)
  const current = entity === 'item' ? loadDataset(db).items.find((i) => i.code === key)! : loadDataset(db).quotes.find((q) => q.id === key)!
  let changed = 0
  tx(db, () => {
    for (const [field, value] of Object.entries(changes)) {
      const col = EDITABLE[entity][field]
      if (!col) throw new Error(`Campo não editável: ${field}`)
      const importedValue = col === 'is_reference' ? Number(imported[col]) === 1 : imported[col] ?? null
      const old = (current as unknown as Record<string, unknown>)[field] ?? null
      if (JSON.stringify(old) === JSON.stringify(value ?? null)) continue
      if (JSON.stringify(importedValue) === JSON.stringify(value ?? null)) {
        db.prepare('DELETE FROM overrides WHERE entity_type = ? AND entity_key = ? AND field = ?').run(entity, key, field)
      } else {
        db.prepare(
          `INSERT INTO overrides (entity_type, entity_key, field, value, base_value, updated_at, actor) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(entity_type, entity_key, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, actor = excluded.actor`,
        ).run(entity, key, field, JSON.stringify(value ?? null), JSON.stringify(importedValue), now(), actor)
      }
      audit(db, entity, key, field, old, value, actor)
      changed++
    }
  })
  return changed
}

export function setActiveScenario(id: StructuralScenario | null, actor: string, db: DatabaseSync = getDb()) {
  const prev = db.prepare('SELECT id FROM scenarios WHERE is_active = 1').get() as Row | undefined
  tx(db, () => {
    db.prepare('UPDATE scenarios SET is_active = 0').run()
    if (id) {
      const r = db.prepare('UPDATE scenarios SET is_active = 1 WHERE id = ?').run(id)
      if (Number(r.changes) !== 1) throw new Error('Cenário inexistente')
    }
    audit(db, 'scenario', 'ativo', 'is_active', prev?.id ?? null, id, actor)
  })
}

export function addContract(
  input: { itemCodes: string[]; quoteId: string | null; supplier: string | null; object: string; amount: number; signedAt: string | null; documentRef: string | null; notes: string | null },
  actor: string,
  db: DatabaseSync = getDb(),
): string {
  if (!(input.amount > 0)) throw new Error('Valor do contrato deve ser positivo')
  if (!input.itemCodes.length) throw new Error('Contrato precisa de ao menos um pacote')
  const count = (db.prepare("SELECT COUNT(*) AS c FROM contracts WHERE origin = 'manual'").get() as Row).c
  const id = `CT-M-${String(Number(count) + 1).padStart(3, '0')}`
  tx(db, () => {
    let supplierId: string | null = null
    if (input.supplier) {
      supplierId = `SUP-${input.supplier.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
      db.prepare('INSERT OR IGNORE INTO suppliers (id, name) VALUES (?, ?)').run(supplierId, input.supplier)
    }
    db.prepare("INSERT INTO contracts (id, quote_id, supplier_id, object, contract_amount, additives, approved_at, status, document_ref, notes, origin) VALUES (?,?,?,?,?,NULL,?,'Assinado',?,?,'manual')").run(id, input.quoteId, supplierId, input.object, input.amount, input.signedAt, input.documentRef, input.notes)
    for (const c of input.itemCodes) db.prepare('INSERT INTO contract_items (contract_id, item_code) VALUES (?,?)').run(id, c)
    audit(db, 'contract', id, 'criado', null, { amount: input.amount, items: input.itemCodes, quote: input.quoteId }, actor)
    if (input.quoteId) {
      const q = loadDataset(db).quotes.find((x) => x.id === input.quoteId)
      if (q && q.status !== 'contratada') {
        db.prepare(
          `INSERT INTO overrides (entity_type, entity_key, field, value, base_value, updated_at, actor) VALUES ('quote',?,?,?,?,?,?)
           ON CONFLICT(entity_type, entity_key, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, actor = excluded.actor`,
        ).run(input.quoteId, 'status', JSON.stringify('contratada'), JSON.stringify((db.prepare('SELECT status FROM quotes WHERE id = ?').get(input.quoteId) as Row).status), now(), actor)
        audit(db, 'quote', input.quoteId, 'status', q.status, 'contratada', actor)
      }
    }
  })
  return id
}

export function addMeasurement(input: { contractId: string; period: string; measured: number | null; paid: number | null }, actor: string, db: DatabaseSync = getDb()): string {
  if (input.measured === null && input.paid === null) throw new Error('Informe medido e/ou pago')
  if ((input.measured ?? 0) < 0 || (input.paid ?? 0) < 0) throw new Error('Valores não podem ser negativos')
  const c = db.prepare('SELECT id FROM contracts WHERE id = ?').get(input.contractId)
  if (!c) throw new Error('Contrato inexistente')
  const count = (db.prepare('SELECT COUNT(*) AS c FROM measurements WHERE contract_id = ?').get(input.contractId) as Row).c
  const id = `${input.contractId}-MED-${String(Number(count) + 1).padStart(3, '0')}`
  tx(db, () => {
    db.prepare("INSERT INTO measurements (id, contract_id, period, measured_amount, paid_amount, origin) VALUES (?,?,?,?,?,'manual')").run(id, input.contractId, input.period, input.measured, input.paid)
    audit(db, 'contract', input.contractId, 'medição', null, input, actor)
  })
  return id
}

export function resolveConflict(id: number, decision: 'keep-manual' | 'accept-import', actor: string, db: DatabaseSync = getDb()) {
  const c = db.prepare("SELECT * FROM import_conflicts WHERE id = ? AND status = 'pendente'").get(id) as Row | undefined
  if (!c) throw new Error('Conflito não encontrado ou já resolvido')
  tx(db, () => {
    if (decision === 'accept-import') {
      db.prepare('DELETE FROM overrides WHERE entity_type = ? AND entity_key = ? AND field = ?').run(c.entity_type, c.entity_key, c.field)
    } else {
      db.prepare('UPDATE overrides SET base_value = ? WHERE entity_type = ? AND entity_key = ? AND field = ?').run(c.new_import_value, c.entity_type, c.entity_key, c.field)
    }
    db.prepare("UPDATE import_conflicts SET status = 'resolvido', resolved_at = ?, resolution = ? WHERE id = ?").run(now(), decision, id)
    audit(db, String(c.entity_type), String(c.entity_key), String(c.field), c.manual_value, decision === 'accept-import' ? c.new_import_value : c.manual_value, actor)
  })
}
