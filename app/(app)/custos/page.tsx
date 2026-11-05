import type { Metadata } from 'next'
import { Bar, Chips, Coverage, ListLink, Money, PageHeader, Segmented } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { formatPct } from '@/lib/format'

export const metadata: Metadata = { title: 'Custos' }

type Sort = 'etapa' | 'valor'
type Filter = 'todas' | 'com-valor' | 'sem-valor'

export default async function Custos({ searchParams }: { searchParams: Promise<{ ordem?: string; filtro?: string }> }) {
  const sp = await searchParams
  const sort: Sort = sp.ordem === 'valor' ? 'valor' : 'etapa'
  const filter: Filter = sp.filtro === 'com-valor' || sp.filtro === 'sem-valor' ? sp.filtro : 'todas'
  const { cats, summary: s, units } = await getReadyContext()

  let list = [...cats]
  if (filter === 'com-valor') list = list.filter((c) => c.subtotal !== null)
  if (filter === 'sem-valor') list = list.filter((c) => c.unpricedCount > 0)
  if (sort === 'valor') list.sort((a, b) => (b.subtotal ?? -1) - (a.subtotal ?? -1) || a.sortOrder - b.sortOrder)
  else list.sort((a, b) => a.sortOrder - b.sortOrder)
  const max = Math.max(0, ...cats.map((c) => c.subtotal ?? 0)) || null
  const multi = units.filter((u) => u.category === 'MULTI' && u.estimate !== null)
  const href = (o: Partial<{ ordem: Sort; filtro: Filter }>) => {
    const q = new URLSearchParams({ ordem: o.ordem ?? sort, filtro: o.filtro ?? filter })
    return `/custos?${q}`
  }

  return (
    <>
      <PageHeader title="Custos" subtitle={`${cats.length} macroetapas · ${s.inScopeItems} pacotes no escopo`} />

      <div className="card sticky top-[calc(44px+env(safe-area-inset-top))] z-20 mb-4 p-4 shadow-[0_6px_16px_-12px_rgba(0,0,0,0.25)]" data-testid="costs-total">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium tracking-wide text-muted uppercase">Total conhecido</span>
          <Money value={s.estimateTotal} className="text-[20px] font-semibold" />
        </div>
        <div className="mt-2">
          <Coverage done={s.coveredItems} total={s.inScopeItems} />
        </div>
        <div className="mt-1 text-[12.5px] text-muted">
          Cobertura {formatPct(s.coverage)} · {s.unpricedItems} pacotes sem preço
        </div>
      </div>

      <div className="space-y-3">
        <Segmented
          label="Ordenação"
          options={[
            { href: href({ ordem: 'etapa' }), label: 'Por etapa', active: sort === 'etapa', testId: 'sort-etapa' },
            { href: href({ ordem: 'valor' }), label: 'Por valor', active: sort === 'valor', testId: 'sort-valor' },
          ]}
        />
        <Chips
          label="Filtro"
          options={[
            { href: href({ filtro: 'todas' }), label: 'Todas', active: filter === 'todas', count: cats.length, testId: 'filter-todas' },
            { href: href({ filtro: 'com-valor' }), label: 'Com valor', active: filter === 'com-valor', count: cats.filter((c) => c.subtotal !== null).length, testId: 'filter-com-valor' },
            { href: href({ filtro: 'sem-valor' }), label: 'Com pendência de preço', active: filter === 'sem-valor', count: cats.filter((c) => c.unpricedCount > 0).length, testId: 'filter-sem-valor' },
          ]}
        />
      </div>

      {list.length === 0 ? (
        <div className="card mt-4 p-5 text-center text-[14px] text-muted">Nenhuma macroetapa neste filtro.</div>
      ) : (
        <ul className="card mt-4 divide-y divide-line" data-testid="category-list">
          {list.map((c) => (
            <li key={c.code}>
              <ListLink href={`/custos/${c.code}`} testId={`category-${c.code}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-[15.5px] font-medium">
                    <span className="num mr-1.5 text-muted">{c.code}</span>
                    {c.name}
                  </span>
                  <Money value={c.subtotal} className="shrink-0 text-[15px] font-semibold" />
                </div>
                <div className="mt-2">
                  <Bar value={c.subtotal} max={max} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-[12.5px] text-muted">
                  <span>{c.itemCount} itens</span>
                  <span>{c.unpricedCount} sem valor</span>
                  {c.inScopeCount !== c.itemCount && <span>{c.itemCount - c.inScopeCount} alternativa(s) fora do cenário</span>}
                  <span>{c.pctOfKnown === null ? '— do conhecido' : `${formatPct(c.pctOfKnown)} do conhecido`}</span>
                </div>
              </ListLink>
            </li>
          ))}
        </ul>
      )}
      {multi.length > 0 && <p className="mt-3 px-1 text-[13px] text-muted">{multi.length} proposta(s) global(is) cobrem mais de uma macroetapa e aparecem separadas, sem rateio.</p>}
    </>
  )
}
