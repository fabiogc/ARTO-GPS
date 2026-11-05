import type { Metadata } from 'next'
import { BackButton } from '@/components/nav'
import { Chips, PageHeader } from '@/components/ui'
import { getDb } from '@/lib/repo'
import { requireAdmin } from '@/lib/session'
import type { Row } from '@/lib/db'

export const metadata: Metadata = { title: 'Planilha original' }

export default async function Planilha({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  const db = getDb()
  const sheets = (db.prepare('SELECT sheet, COUNT(*) AS n, MIN(rowid) AS o FROM sheet_rows GROUP BY sheet ORDER BY o').all() as Row[]).map((r) => ({ name: String(r.sheet), n: Number(r.n) }))
  const current = sheets.find((s) => s.name === sp.aba)?.name ?? sheets[0]?.name
  const rows = (db.prepare('SELECT row, data FROM sheet_rows WHERE sheet = ? ORDER BY row LIMIT 400').all(current) as Row[]).map((r) => ({ row: Number(r.row), cells: JSON.parse(String(r.data)) as Record<string, { v: unknown; f?: string }> }))
  return (
    <>
      <PageHeader back={<BackButton fallback="/mais" label="Mais" />} title="Planilha original" subtitle="Cópia somente leitura de todas as células importadas (valores e fórmulas)" />
      <Chips label="Abas" options={sheets.map((s) => ({ href: `/planilha?aba=${encodeURIComponent(s.name)}`, label: s.name, active: s.name === current, count: s.n }))} />
      <ul className="card mt-3 divide-y divide-line text-[12.5px]">
        {rows.map((r) => {
          const entries = Object.entries(r.cells).filter(([, c]) => c.v !== null)
          if (!entries.length) return null
          return (
            <li key={r.row} className="px-3 py-2">
              <span className="num mr-2 font-semibold text-muted">L{r.row}</span>
              {entries.map(([col, c]) => (
                <span key={col} className="mr-2 break-words">
                  <span className="text-muted">{col}:</span> {String(c.v)}
                </span>
              ))}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 px-1 text-[12.5px] text-muted">Células de fórmula são omitidas nesta visão (recalculadas no app). Linhas com apenas fórmulas não aparecem.</p>
    </>
  )
}
