/**
 * Importa a planilha V4 para o SQLite local de forma determinística e idempotente.
 *
 *   npm run import                       # usa V4_XLSX_PATH ou data/private/<planilha>.xlsx
 *   npm run import -- --file caminho.xlsx --db data/private/arto.db
 *   npm run import -- --resolve keep-manual | accept-import   # decide conflitos com edições manuais
 *   npm run import -- --dry-run          # só gera o relatório
 *   npm run import -- --fresh --db x.db  # recria o banco do zero (descarta edições manuais; usado no E2E)
 *
 * A planilha original nunca é modificada. Relatórios: data/private/import-report.{md,json}
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defaultDbPath, openDb } from '../lib/db'
import { applyImport, normalizeV4, reportToMarkdown, type Resolution } from '../lib/import/import-v4'
import { parseV4 } from '../lib/import/parse-v4'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const file = resolve(arg('file') ?? (process.env.V4_XLSX_PATH || 'data/private/ARTO_Caico_Orcamento_V4_Quantificacao_Integral.xlsx'))
const dbPath = resolve(arg('db') ?? defaultDbPath())
const resolution = (arg('resolve') ?? 'ask') as Resolution
const dryRun = process.argv.includes('--dry-run')
const legacyPath = resolve(arg('legacy') ?? (process.env.LEGACY_JSON_PATH || 'data/private/ARTO_Caico_MVP_dados.json'))

if (!existsSync(file)) {
  console.error(`Planilha não encontrada: ${file}\nCopie a V4 para data/private/ ou informe --file.`)
  process.exit(1)
}
if (!['ask', 'keep-manual', 'accept-import'].includes(resolution)) {
  console.error('--resolve deve ser ask | keep-manual | accept-import')
  process.exit(1)
}

const parsed = await parseV4(file)
const legacy = existsSync(legacyPath) ? JSON.parse(readFileSync(legacyPath, 'utf8')) : null
const normalized = normalizeV4(parsed, legacy)
const errors = normalized.report.issues.filter((i) => i.level === 'erro')
if (errors.length) {
  console.error('Erros estruturais na planilha — importação abortada:')
  for (const e of errors) console.error(` - ${e.sheet ?? ''}: ${e.message}`)
  process.exit(1)
}

let report = normalized.report
if (process.argv.includes('--fresh') && !dryRun) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
}
if (!dryRun) {
  const db = openDb(dbPath)
  report = applyImport(db, normalized, { resolution })
  db.close()
}
const outDir = dirname(dbPath)
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'import-report.json'), JSON.stringify(report, null, 2))
writeFileSync(resolve(outDir, 'import-report.md'), reportToMarkdown(report))

const c = report.coverage
console.log(`✔ ${dryRun ? 'Simulação' : 'Importação'} concluída: ${file.split('/').pop()}`)
console.log(`  Pacotes ${c.items} · macroetapas ${c.categories} · propostas ${report.counts.quotes} · contratos ${report.counts.contracts}`)
console.log(`  Orçamento de referência: ${c.referencePriced} precificados / ${c.referenceUnpriced} sem preço`)
console.log(`  Cobertos por proposta global: ${c.itemsCoveredByComparableQuote} · sem nenhum valor: ${c.itemsWithoutAnyValue}`)
console.log(`  Divergências: ${report.divergences.length} · alertas: ${report.alerts.length}`)
if (report.sync) {
  const t = Object.values(report.sync).reduce((a, s) => ({ i: a.i + s.inserted, u: a.u + s.updated, r: a.r + s.removed }), { i: 0, u: 0, r: 0 })
  console.log(`  Banco: +${t.i} inseridas · ${t.u} atualizadas · ${t.r} removidas → ${dbPath}`)
}
if (report.conflicts?.length) {
  console.log(`\n⚠ ${report.conflicts.length} conflito(s) entre a planilha e edições manuais:`)
  for (const k of report.conflicts) console.log(`  - ${k.entity} ${k.key}.${k.field}: ${k.action}`)
  if (resolution === 'ask') console.log('  Resolva no app (Mais › Relatório) ou reimporte com --resolve keep-manual | accept-import')
}
console.log(`  Relatório: ${resolve(outDir, 'import-report.md')}`)
