import type { Metadata } from 'next'
import Link from 'next/link'
import { AbcChart, CLASS_COLOR, type AbcPoint } from '@/components/abc-chart'
import { Banner, EmptyState, Money, PageHeader, Section, Segmented } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { abcFromUnits, type AbcBase, type AbcMode } from '@/lib/finance'
import { formatBRL, formatPct } from '@/lib/format'

export const metadata: Metadata = { title: 'Curva ABC' }

export default async function AbcPage({ searchParams }: { searchParams: Promise<{ base?: string; por?: string }> }) {
  const sp = await searchParams
  const base: AbcBase = sp.base === 'referencia' ? 'referencia' : 'estimativa'
  const mode: AbcMode = sp.por === 'categorias' ? 'categorias' : 'itens'
  const { units, ds, summary: s } = await getReadyContext()
  const r = abcFromUnits(units, ds.categories, mode, base)
  const pricedItems = base === 'estimativa' ? s.coveredItems : s.referencePricedItems
  const coverage = s.inScopeItems ? pricedItems / s.inScopeItems : 0
  const href = (o: { base?: AbcBase; por?: AbcMode }) => `/abc?${new URLSearchParams({ base: o.base ?? base, por: o.por ?? mode })}`
  const linkFor = (key: string) => (mode === 'categorias' ? (key === 'MULTI' ? '/custos' : `/custos/${key}`) : key.startsWith('GRUPO:') ? `/itens/${key.slice(6).split('+')[0]}` : `/itens/${key}`)
  const points: AbcPoint[] = r.rows.slice(0, 15).map((row) => ({
    key: row.key,
    short: `${row.rank}. ${row.label.length > 16 ? `${row.label.slice(0, 15)}…` : row.label}`,
    label: row.label,
    value: row.value,
    valueLabel: formatBRL(row.value),
    pctLabel: formatPct(row.pct),
    cumLabel: formatPct(row.cumPct),
    cls: row.cls,
  }))
  const counts = { A: r.rows.filter((x) => x.cls === 'A').length, B: r.rows.filter((x) => x.cls === 'B').length, C: r.rows.filter((x) => x.cls === 'C').length }

  return (
    <>
      <PageHeader title="Curva ABC" subtitle="Ranking dos custos conhecidos e concentração acumulada" />
      <div className="space-y-3">
        <Segmented
          label="Base de valores"
          options={[
            { href: href({ base: 'estimativa' }), label: 'Estimativa atual', active: base === 'estimativa', testId: 'abc-base-estimativa' },
            { href: href({ base: 'referencia' }), label: 'Orçamento-base', active: base === 'referencia', testId: 'abc-base-referencia' },
          ]}
        />
        <Segmented
          label="Agrupamento"
          options={[
            { href: href({ por: 'itens' }), label: 'Itens', active: mode === 'itens', testId: 'abc-mode-itens' },
            { href: href({ por: 'categorias' }), label: 'Macroetapas', active: mode === 'categorias', testId: 'abc-mode-categorias' },
          ]}
        />
      </div>

      <div className="mt-4">
        <Banner tone={coverage < 0.8 ? 'warn' : 'neutral'} title={coverage < 1 ? 'ABC PARCIAL — não representa o hospital completo' : undefined} testId="abc-banner">
          Denominador: <strong>{r.total === null ? 'sem valores' : formatBRL(r.total)}</strong> em {r.pricedEntries} {mode === 'itens' ? 'entrada(s)' : 'macroetapa(s)'} com valor. Cobertura de precificação: {pricedItems} de {s.inScopeItems} pacotes ({formatPct(coverage)}).
        </Banner>
      </div>

      {r.rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="Sem valores para esta base" action={<Link href={href({ base: 'estimativa' })} className="btn btn-secondary">Ver estimativa atual</Link>}>
            {base === 'referencia'
              ? `Nenhum pacote tem quantidade × preço de referência (${s.referencePricedItems} de ${s.inScopeItems}). A curva desta base aparece quando os valores forem lançados na planilha ou no app.`
              : 'Nenhum pacote tem valor conhecido ainda.'}
          </EmptyState>
        </div>
      ) : (
        <>
          <Section title={r.rows.length > 15 ? 'Top 15' : 'Gráfico'}>
            <div className="card p-3">
              <AbcChart data={points} />
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12.5px] text-ink-2" aria-label="Legenda">
                {(['A', 'B', 'C'] as const).map((c) => (
                  <li key={c} className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CLASS_COLOR[c] }} />
                    Classe {c} ({counts[c]}) · {c === 'A' ? 'até 80%' : c === 'B' ? '80–95%' : 'acima de 95%'}
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section title="Ranking">
            <ol className="card divide-y divide-line" data-testid="abc-table">
              {r.rows.map((row) => (
                <li key={row.key}>
                  <Link href={linkFor(row.key)} className="tap flex items-start gap-3 px-4 py-3 active:bg-[#f1f0ec]">
                    <span className="num w-6 shrink-0 pt-0.5 text-[13px] text-muted">{row.rank}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] leading-snug font-medium">{row.label}</span>
                      <span className="num mt-0.5 block text-[12.5px] text-muted">
                        {formatPct(row.pct)} individual · {formatPct(row.cumPct)} acumulado
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Money value={row.value} className="block text-[14.5px] font-semibold" />
                      <span className="mt-0.5 inline-block rounded px-1.5 text-[12px] font-semibold text-white" style={{ background: CLASS_COLOR[row.cls], color: row.cls === 'C' ? '#15212b' : '#fff' }}>
                        {row.cls}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}

      <Section title="Notas metodológicas">
        <ul className="card list-disc space-y-1.5 py-4 pr-4 pl-8 text-[13.5px] leading-snug text-ink-2">
          <li>Estimativa atual: por pacote, contrato › proposta de referência › orçamento-base. Uma fonte por pacote.</li>
          <li>Propostas globais de vários pacotes entram como uma linha única (sem rateio arbitrário).</li>
          <li>Pacotes sem valor ficam fora do ranking — não são tratados como R$ 0 — e reduzem a cobertura.</li>
          <li>Tarifas (R$/dia), valores mensais, opcionais e propostas com vínculo divergente não entram.</li>
          <li>Classe A: itens até 80% do acumulado (o item que cruza 80% é A); B até 95%; C o restante.</li>
          <li>Alternativas estruturais só entram se o cenário estiver ativo; nunca as três juntas.</li>
        </ul>
      </Section>
    </>
  )
}
