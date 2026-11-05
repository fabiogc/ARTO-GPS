import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SCHEMA = /* sql */ `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, full_name TEXT, location TEXT,
  area_m2 REAL, ground_m2 REAL, upper_m2 REAL, land_m2 REAL, beds INTEGER,
  version TEXT, source_file TEXT, base_date TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  code TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  code TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  category_code TEXT NOT NULL REFERENCES categories(code), category_name TEXT,
  description TEXT NOT NULL, unit TEXT,
  quantity REAL, reference_unit_price REAL, -- NULL = não informado (nunca 0 como substituto)
  price_type TEXT, price_date TEXT, source TEXT, confidence TEXT, status TEXT,
  quote_status_raw TEXT, supplier_chosen TEXT, doc_link TEXT, responsible TEXT, notes TEXT,
  scenario TEXT NOT NULL DEFAULT 'base', scenario_inferred INTEGER NOT NULL DEFAULT 0,
  cost_kind TEXT NOT NULL DEFAULT 'direto', sheet_row INTEGER
);
CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, contact TEXT);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY, package_raw TEXT, supplier_id TEXT REFERENCES suppliers(id), service TEXT,
  received_at TEXT, amount REAL, amount_kind TEXT NOT NULL, unit_label TEXT, includes_taxes TEXT, freight REAL,
  status TEXT NOT NULL, status_raw TEXT, is_verbal INTEGER NOT NULL DEFAULT 0, is_optional INTEGER NOT NULL DEFAULT 0,
  is_reference INTEGER NOT NULL DEFAULT 0, is_internal INTEGER NOT NULL DEFAULT 0, duration_days REAL, validity TEXT, document_ref TEXT, scope TEXT,
  responsible TEXT, next_action TEXT, follow_up TEXT, notes TEXT, link_status TEXT NOT NULL, link_note TEXT,
  origin TEXT NOT NULL DEFAULT 'planilha', sheet_row INTEGER
);
-- Proposta global cobrindo vários pacotes, sem rateio arbitrário
CREATE TABLE IF NOT EXISTS quote_items (
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE, item_code TEXT NOT NULL REFERENCES items(code),
  PRIMARY KEY (quote_id, item_code)
);
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, quote_id TEXT REFERENCES quotes(id), supplier_id TEXT REFERENCES suppliers(id), object TEXT,
  contract_amount REAL, additives REAL, approved_at TEXT, start_at TEXT, end_at TEXT, status TEXT,
  document_ref TEXT, notes TEXT, origin TEXT NOT NULL, sheet_row INTEGER
);
CREATE TABLE IF NOT EXISTS contract_items (
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, item_code TEXT NOT NULL REFERENCES items(code),
  PRIMARY KEY (contract_id, item_code)
);
CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE, period TEXT NOT NULL,
  measured_amount REAL, paid_amount REAL, origin TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0, direct_cost REAL, comparability TEXT, notes TEXT, sheet_row INTEGER
);
CREATE TABLE IF NOT EXISTS pendencias (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, info TEXT, document TEXT, status_raw TEXT, groups_json TEXT NOT NULL, sheet_row INTEGER
);
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY, phase TEXT, title TEXT, planned_start TEXT, planned_end TEXT, real_start TEXT, real_end TEXT,
  progress REAL, responsible TEXT, status TEXT, sheet_row INTEGER
);
CREATE TABLE IF NOT EXISTS cashflow (month TEXT PRIMARY KEY, planned REAL, realized REAL, sheet_row INTEGER);
CREATE TABLE IF NOT EXISTS reference_values (
  id TEXT PRIMARY KEY, sheet TEXT NOT NULL, sheet_row INTEGER NOT NULL, label TEXT NOT NULL, value REAL, value_text TEXT,
  unit TEXT, notes TEXT, source TEXT
);
CREATE TABLE IF NOT EXISTS source_records (
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, workbook_sheet TEXT NOT NULL, workbook_row INTEGER NOT NULL,
  source_document TEXT, notes TEXT, PRIMARY KEY (entity_type, entity_id)
);
-- Cópia sem perda de todas as células da planilha (valor, fórmula, cache)
CREATE TABLE IF NOT EXISTS sheet_rows (sheet TEXT NOT NULL, row INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (sheet, row));
-- Edições manuais: sobrevivem à reimportação
CREATE TABLE IF NOT EXISTS overrides (
  entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, field TEXT NOT NULL,
  value TEXT, base_value TEXT, updated_at TEXT NOT NULL, actor TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_key, field)
);
CREATE TABLE IF NOT EXISTS import_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, field TEXT NOT NULL,
  manual_value TEXT, previous_import_value TEXT, new_import_value TEXT, status TEXT NOT NULL, detected_at TEXT NOT NULL,
  resolved_at TEXT, resolution TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, field TEXT NOT NULL,
  old_value TEXT, new_value TEXT, at TEXT NOT NULL, actor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, file TEXT NOT NULL, sha256 TEXT NOT NULL, summary TEXT NOT NULL, report TEXT NOT NULL
);
`

export function defaultDbPath(): string {
  return resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATABASE_PATH || 'data/private/arto.db')
}

export function openDb(path = defaultDbPath(), opts: { readOnly?: boolean } = {}): DatabaseSync {
  if (!opts.readOnly) mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path, { readOnly: opts.readOnly ?? false })
  if (!opts.readOnly) {
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(SCHEMA)
    migrate(db)
  }
  return db
}

/** Migrações aditivas para bancos criados por versões anteriores. */
function migrate(db: DatabaseSync) {
  const cols = (db.prepare('PRAGMA table_info(quotes)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('is_internal')) db.exec('ALTER TABLE quotes ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0')
}

/** Colunas 0/1 tratadas como booleanas nas edições manuais. */
export const BOOLEAN_COLUMNS = new Set(['is_reference', 'is_internal'])

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export type Row = Record<string, string | number | null>
