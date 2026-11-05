import type { Metadata } from 'next'
import { Badge, Banner, Chips, ListLink, PageHeader } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { isQuoteComparable, quoteExclusionReason } from '@/lib/finance'
import { formatDate } from '@/lib/format'
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_ORDER, quoteAmountLabel } from '@/lib/labels'
import { requireAdmin } from '@/lib/session'
import type { QuoteStatus } from '@/lib/types'

export const metadata: Metadata = { title: 'Propostas' }

export default async function Propostas({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  const { ds } = await getReadyContext()
  const status = QUOTE_STATUS_ORDER.includes(sp.status as QuoteStatus) ? (sp.status as QuoteStatus) : null
  const list = status ? ds.quotes.filter((q) => q.status === status) : ds.quotes
  const present = QUOTE_STATUS_ORDER.filter((st) => ds.quotes.some((q) => q.status === st))

  return (
    <>
      <PageHeader title="Propostas" subtitle={`${ds.quotes.length} registradas · ${ds.quotes.filter(isQuoteComparable).length} com valor global comparável`} />
      <Banner tone="neutral">Propostas não se somam entre si nem ao orçamento. Só viram “contratado” com contrato registrado explicitamente.</Banner>
      <div className="mt-4">
        <Chips
          label="Filtrar por status"
          options={[
            { href: '/propostas', label: 'Todas', active: !status, count: ds.quotes.length, testId: 'quote-filter-todas' },
            ...QUOTE_STATUS_ORDER.map((st) => ({ href: `/propostas?status=${st}`, label: QUOTE_STATUS_LABEL[st], active: status === st, count: ds.quotes.filter((q) => q.status === st).length, testId: `quote-filter-${st}` })).filter((o) => o.count > 0 || o.active || present.length === 0),
          ]}
        />
      </div>
      {list.length === 0 ? (
        <div className="card mt-4 p-5 text-center text-[14px] text-muted" data-testid="empty-state">
          Nenhuma proposta com status “{status ? QUOTE_STATUS_LABEL[status] : ''}”.
        </div>
      ) : (
        <ul className="card mt-4 divide-y divide-line" data-testid="quote-list">
          {list.map((q) => {
            const reason = quoteExclusionReason(q)
            return (
              <li key={q.id}>
                <ListLink href={`/propostas/${encodeURIComponent(q.id)}`} testId={`quote-${q.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-[15.5px] font-semibold">{q.supplier ?? 'Fornecedor não informado'}</span>
                    <span className="shrink-0 text-right text-[14.5px] font-semibold">{quoteAmountLabel(q)}</span>
                  </div>
                  <div className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{q.service}</div>
                  <div className="mt-1 text-[12.5px] text-muted">
                    {q.packageRaw ?? 'sem pacote'}
                    {q.itemCodes.length > 1 ? ` → ${q.itemCodes.join(', ')}` : ''} · {q.receivedAt ? formatDate(q.receivedAt) : 'sem data'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                    {q.isVerbal && <Badge tone="warn">Informado verbalmente</Badge>}
                    {q.linkStatus === 'inferido' && <Badge tone="neutral">Vínculo inferido</Badge>}
                    {reason && <Badge tone="gap">{reason}</Badge>}
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
