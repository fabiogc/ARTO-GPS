import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BackButton } from '@/components/nav'
import { Badge, Chips, Coverage, ListLink, Money, PageHeader } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { isInScope } from '@/lib/finance'
import { formatPct } from '@/lib/format'
import { ESTIMATE_SOURCE_LABEL, SCENARIO_LABEL } from '@/lib/labels'

export async function generateMetadata({ params }: { params: Promise<{ grupo: string }> }): Promise<Metadata> {
  return { title: `Macroetapa ${(await params).grupo}` }
}

export default async function Categoria({ params, searchParams }: { params: Promise<{ grupo: string }>; searchParams: Promise<{ filtro?: string }> }) {
  const { grupo } = await params
  const sp = await searchParams
  const { ds, cats, unitByItem, opts } = await getReadyContext()
  const cat = cats.find((c) => c.code === grupo)
  if (!cat) notFound()
  const filter = sp.filtro === 'com-valor' || sp.filtro === 'sem-valor' ? sp.filtro : 'todos'
  const all = ds.items.filter((i) => i.group === grupo)
  const hasValue = (code: string) => unitByItem.get(code)?.estimate != null
  const items = all.filter((i) => (filter === 'com-valor' ? hasValue(i.code) : filter === 'sem-valor' ? isInScope(i, opts.activeScenario) && !hasValue(i.code) : true))
  const base = `/custos/${grupo}`

  return (
    <>
      <PageHeader back={<BackButton fallback="/custos" label="Custos" />} title={cat.name} subtitle={`Macroetapa ${cat.code} · ${cat.itemCount} itens`} />
      <div className="card mb-4 p-4" data-testid="category-total">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium tracking-wide text-muted uppercase">Subtotal conhecido</span>
          <Money value={cat.subtotal} className="text-[20px] font-semibold" />
        </div>
        <div className="mt-2">
          <Coverage done={cat.pricedCount} total={cat.inScopeCount} />
        </div>
        <div className="mt-1 text-[12.5px] text-muted">
          {cat.unpricedCount} sem valor · {cat.pctOfKnown === null ? 'sem participação no conhecido' : `${formatPct(cat.pctOfKnown)} do total conhecido`} · {cat.quoteCount} proposta(s)
        </div>
      </div>
      <Chips
        label="Filtro de itens"
        options={[
          { href: base, label: 'Todos', active: filter === 'todos', count: all.length, testId: 'item-filter-todos' },
          { href: `${base}?filtro=com-valor`, label: 'Com valor', active: filter === 'com-valor', count: all.filter((i) => hasValue(i.code)).length, testId: 'item-filter-com-valor' },
          { href: `${base}?filtro=sem-valor`, label: 'Sem valor', active: filter === 'sem-valor', count: all.filter((i) => isInScope(i, opts.activeScenario) && !hasValue(i.code)).length, testId: 'item-filter-sem-valor' },
        ]}
      />
      {items.length === 0 ? (
        <div className="card mt-4 p-5 text-center text-[14px] text-muted" data-testid="empty-state">Nenhum item neste filtro.</div>
      ) : (
        <ul className="card mt-4 divide-y divide-line" data-testid="item-list">
          {items.map((i) => {
            const u = unitByItem.get(i.code)
            const inScope = isInScope(i, opts.activeScenario)
            const grouped = u && u.itemCodes.length > 1
            return (
              <li key={i.code}>
                <ListLink href={`/itens/${i.code}`} testId={`item-${i.code}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-[15px] leading-snug font-medium">
                      <span className="num mr-1.5 text-muted">{i.code}</span>
                      {i.description}
                    </span>
                    <span className="shrink-0 text-right text-[14.5px] font-semibold">
                      {!inScope ? <span className="font-medium text-muted">Fora do cenário</span> : grouped ? <span className="font-medium text-ink-2">Em grupo</span> : <Money value={u?.estimate ?? null} />}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {u?.estimateSource && <Badge tone="accent">{ESTIMATE_SOURCE_LABEL[u.estimateSource]}</Badge>}
                    {grouped && <Badge tone="neutral">Proposta global · {u!.itemCodes.length} pacotes (sem rateio)</Badge>}
                    {i.scenario !== 'base' && <Badge tone={inScope ? 'neutral' : 'gap'}>{SCENARIO_LABEL[i.scenario]}</Badge>}
                    {i.costKind === 'equipamento_medico' && <Badge tone="neutral">Equipamento médico</Badge>}
                    {i.costKind === 'contingencia' && <Badge tone="neutral">Contingência</Badge>}
                    {i.status !== 'Não iniciado' && <Badge tone="warn">{i.status}</Badge>}
                    {i.edited.length > 0 && <Badge tone="ok">Editado no app</Badge>}
                  </div>
                </ListLink>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
