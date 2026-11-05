import type { Metadata } from 'next'
import Link from 'next/link'
import { BackButton } from '@/components/nav'
import { Badge, Banner, Chips, PageHeader } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { isInScope } from '@/lib/finance'
import { CATEGORY_RISK, pendenciaRiskTier } from '@/lib/import/rules'

export const metadata: Metadata = { title: 'Pendências' }

const TIER_ORDER = { alto: 0, medio: 1, baixo: 2 } as const
const TIER_LABEL = { alto: 'Risco alto', medio: 'Risco médio', baixo: 'Risco baixo' } as const
const TIER_TONE = { alto: 'danger', medio: 'warn', baixo: 'neutral' } as const

export default async function Pendencias({ searchParams }: { searchParams: Promise<{ aba?: string; risco?: string; limite?: string }> }) {
  const sp = await searchParams
  const tab = sp.aba === 'sem-cotacao' ? 'sem-cotacao' : 'criticas'
  const risk = sp.risco === 'alto' || sp.risco === 'medio' || sp.risco === 'baixo' ? sp.risco : null
  const limit = Math.min(500, Math.max(30, Number(sp.limite) || 40))
  const { ds, unitByItem, opts, isAdmin } = await getReadyContext()

  const unpricedIn = (groups: string[]) => ds.items.filter((i) => groups.includes(i.group) && isInScope(i, opts.activeScenario) && unitByItem.get(i.code)?.estimate == null).length
  const pend = ds.pendencias
    .map((p) => ({ ...p, tier: pendenciaRiskTier(p.title, p.statusRaw), unpriced: unpricedIn(p.groups) }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.unpriced - a.unpriced || a.sheetRow - b.sheetRow)

  const quoted = new Set(ds.quotes.flatMap((q) => q.itemCodes))
  const noQuote = ds.items
    .filter((i) => isInScope(i, opts.activeScenario) && !quoted.has(i.code) && unitByItem.get(i.code)?.estimate == null)
    .map((i) => ({ ...i, tier: CATEGORY_RISK[i.group] ?? 'medio' }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.code.localeCompare(b.code))
  const filtered = risk ? noQuote.filter((i) => i.tier === risk) : noQuote

  return (
    <>
      <PageHeader back={isAdmin ? <BackButton fallback="/mais" label="Mais" /> : undefined} title="Pendências" subtitle="Ordenadas por risco e impacto" />
      <Chips
        label="Abas"
        options={[
          { href: '/pendencias', label: 'Críticas', active: tab === 'criticas', count: pend.length, testId: 'tab-criticas' },
          { href: '/pendencias?aba=sem-cotacao', label: 'Pacotes sem cotação', active: tab === 'sem-cotacao', count: noQuote.length, testId: 'tab-sem-cotacao' },
        ]}
      />
      {tab === 'criticas' ? (
        <>
          <p className="mt-3 px-1 text-[13px] text-muted">Fonte: aba “V4 Pendencias criticas”. Risco = heurística do app (sistemas críticos e estrutura = alto), desempate pelo nº de pacotes sem preço nas macroetapas relacionadas.</p>
          <ul className="card mt-3 divide-y divide-line" data-testid="pendencias-list">
            {pend.map((p) => (
              <li key={p.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[15.5px] font-semibold">{p.title}</span>
                  <Badge tone={TIER_TONE[p.tier]}>{TIER_LABEL[p.tier]}</Badge>
                </div>
                <div className="mt-1 text-[14px] leading-snug text-ink-2">{p.info}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                  <Badge tone="gap">{p.statusRaw}</Badge>
                  {p.document && <span>Base: {p.document}</span>}
                </div>
                {p.groups.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.groups.map((g) => (
                      <Link key={g} href={`/custos/${g}`} className="tap inline-flex items-center rounded-full border border-line-strong px-3 text-[13px] font-medium text-accent">
                        {g} · {ds.categories.find((c) => c.code === g)?.name} ({unpricedIn([g])} sem preço)
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="mt-3">
            <Banner tone="neutral">Pacotes no escopo sem nenhuma proposta e sem valor. Impacto por macroetapa: alto = estrutura, fundações, elétrica, HVAC, gases, incêndio, elevadores e equipamentos.</Banner>
          </div>
          <div className="mt-3">
            <Chips
              label="Filtrar por risco"
              options={[
                { href: '/pendencias?aba=sem-cotacao', label: 'Todos', active: !risk, count: noQuote.length, testId: 'risk-todos' },
                ...(['alto', 'medio', 'baixo'] as const).map((t) => ({ href: `/pendencias?aba=sem-cotacao&risco=${t}`, label: TIER_LABEL[t], active: risk === t, count: noQuote.filter((i) => i.tier === t).length, testId: `risk-${t}` })),
              ]}
            />
          </div>
          <ul className="card mt-3 divide-y divide-line" data-testid="noquote-list">
            {filtered.slice(0, limit).map((i) => (
              <li key={i.code}>
                <Link href={`/itens/${i.code}`} className="tap flex items-start justify-between gap-3 px-4 py-3 active:bg-[#f1f0ec]">
                  <span>
                    <span className="block text-[15px] font-medium">
                      <span className="num mr-1.5 text-muted">{i.code}</span>
                      {i.description}
                    </span>
                    <span className="text-[12.5px] text-muted">{i.categoryName}</span>
                  </span>
                  <Badge tone={TIER_TONE[i.tier]}>{TIER_LABEL[i.tier]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
          {filtered.length > limit && (
            <Link href={`/pendencias?aba=sem-cotacao${risk ? `&risco=${risk}` : ''}&limite=${limit + 60}`} scroll={false} replace className="btn btn-secondary mt-3 w-full" data-testid="load-more">
              Mostrar mais ({filtered.length - limit} restantes)
            </Link>
          )}
        </>
      )}
    </>
  )
}
