import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createContractAction, updateQuoteAction } from '@/app/actions'
import { BackButton } from '@/components/nav'
import { Badge, Banner, Facts, FlashMessage, Money, PageHeader, Section } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { contractUpdatedAmount, isQuoteComparable, quoteExclusionReason } from '@/lib/finance'
import { formatBRL, formatDate, formatDateTime } from '@/lib/format'
import { AMOUNT_KIND_LABEL, QUOTE_STATUS_LABEL, QUOTE_STATUS_ORDER, quoteAmountLabel } from '@/lib/labels'
import { auditFor, sourceRecordsFor } from '@/lib/repo'
import { requireAdmin } from '@/lib/session'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Proposta ${decodeURIComponent((await params).id)}` }
}

export default async function PropostaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireAdmin()
  const { id } = await params
  const sp = await searchParams
  const { ds, unitByItem } = await getReadyContext()
  const q = ds.quotes.find((x) => x.id === decodeURIComponent(id))
  if (!q) notFound()
  const reason = quoteExclusionReason(q)
  const items = ds.items.filter((i) => q.itemCodes.includes(i.code))
  const competitors = ds.quotes.filter((o) => o.id !== q.id && o.itemCodes.some((c) => q.itemCodes.includes(c)))
  const unit = q.itemCodes[0] ? unitByItem.get(q.itemCodes[0]) : undefined
  const usedInEstimate = unit?.chosenQuote?.id === q.id
  const contracts = ds.contracts.filter((c) => c.quoteId === q.id)
  const src = sourceRecordsFor('quote', q.id)
  const history = auditFor('quote', [q.id])

  return (
    <>
      <FlashMessage ok={sp.ok} erro={sp.erro} />
      <PageHeader back={<BackButton fallback="/propostas" label="Propostas" />} title={q.supplier ?? 'Fornecedor não informado'} subtitle={<>{q.service} · <span className="num">{q.id}</span></>} />

      <div className="card p-4" data-testid="quote-amount">
        <div className="text-[12px] font-medium tracking-wide text-muted uppercase">{AMOUNT_KIND_LABEL[q.amountKind]}</div>
        <div className="mt-1 text-[22px] font-semibold">{quoteAmountLabel(q)}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>{QUOTE_STATUS_LABEL[q.status]}</Badge>
          {q.statusRaw && q.statusRaw !== QUOTE_STATUS_LABEL[q.status] && <Badge tone="neutral">Planilha: {q.statusRaw}</Badge>}
          {q.isVerbal && <Badge tone="warn">Informado verbalmente</Badge>}
          {usedInEstimate && <Badge tone="accent">Usada na estimativa atual</Badge>}
          {isQuoteComparable(q) && !usedInEstimate && <Badge tone="neutral">Comparável, não escolhida</Badge>}
        </div>
        {reason && (
          <div className="mt-3">
            <Banner tone="gap" title="Não entra em totais">
              {reason}.
            </Banner>
          </div>
        )}
      </div>

      {q.linkNote && (
        <div className="mt-3">
          <Banner tone={q.linkStatus === 'divergente' || q.linkStatus === 'sem_item' ? 'warn' : 'neutral'} title={q.linkStatus === 'inferido' ? 'Vínculo inferido' : q.linkStatus === 'divergente' ? 'Vínculo divergente' : 'Vínculo'}>
            {q.linkNote}
          </Banner>
        </div>
      )}

      <Section title="Pacotes">
        {items.length === 0 ? (
          <div className="card p-4 text-[14px] text-muted">Sem pacote associado ({q.packageRaw ?? 'código vazio'}).</div>
        ) : (
          <ul className="card divide-y divide-line">
            {items.map((i) => (
              <li key={i.code}>
                <Link href={`/itens/${i.code}`} className="tap block px-4 py-3 active:bg-[#f1f0ec]" data-testid={`quote-item-${i.code}`}>
                  <span className="num mr-1.5 text-muted">{i.code}</span>
                  <span className="font-medium">{i.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Escopo e condições">
        <Facts
          rows={[
            ['Escopo e exclusões', q.scope],
            ['Recebida em', q.receivedAt ? formatDate(q.receivedAt) : null],
            ['Prazo de execução', q.durationDays !== null ? `${q.durationDays} dias` : null],
            ['Validade', q.validity ? formatDate(q.validity) : null],
            ['Inclui impostos?', q.includesTaxes],
            ['Frete / viagem', q.freight !== null ? formatBRL(q.freight) : null],
            ['Documento', q.documentRef],
            ['Próxima ação', q.nextAction],
            ['Responsável', q.responsible],
            ['Origem', src.map((s) => `${s.sheet}, linha ${s.row}`).join('; ') || null],
          ]}
        />
      </Section>

      <Section title={`Concorrentes no mesmo pacote (${competitors.length})`}>
        {competitors.length === 0 ? (
          <div className="card p-4 text-[14px] text-muted">Nenhuma outra proposta registrada para estes pacotes.</div>
        ) : (
          <ul className="card divide-y divide-line">
            {competitors.map((o) => (
              <li key={o.id}>
                <Link href={`/propostas/${encodeURIComponent(o.id)}`} className="tap flex items-start justify-between gap-3 px-4 py-3 active:bg-[#f1f0ec]">
                  <span>
                    <span className="block font-medium">{o.supplier}</span>
                    <span className="text-[13px] text-muted">{o.service}</span>
                  </span>
                  <span className="text-right text-[14px] font-semibold">{quoteAmountLabel(o)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 px-1 text-[13px] text-muted">Concorrentes não são cumulativos: a estimativa usa a marcada como referência ou, na falta dela, a de menor valor global comparável.</p>
      </Section>

      <Section title="Status e referência">
        <form action={updateQuoteAction} className="card space-y-3 p-4" data-testid="quote-status-form">
          <input type="hidden" name="id" value={q.id} />
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium">Status</span>
            <select name="status" defaultValue={q.status} className="field" data-testid="quote-status-select">
              {QUOTE_STATUS_ORDER.map((st) => (
                <option key={st} value={st}>
                  {QUOTE_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </label>
          <label className="tap flex items-center gap-3">
            <input type="checkbox" name="isReference" defaultChecked={q.isReference} className="h-5 w-5 accent-[#0e5a61]" />
            <span className="text-[14.5px]">Usar como proposta de referência do pacote</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium">Notas</span>
            <textarea name="notes" defaultValue={q.notes ?? ''} rows={2} className="field" />
          </label>
          <button type="submit" className="btn btn-primary w-full">
            Salvar
          </button>
        </form>
      </Section>

      <Section title="Contrato (camada C)">
        {contracts.length > 0 ? (
          <ul className="card divide-y divide-line">
            {contracts.map((c) => (
              <li key={c.id} className="flex justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block font-medium">{c.id}</span>
                  <span className="text-[13px] text-muted">{c.signedAt ? formatDate(c.signedAt) : 'sem data'}</span>
                </span>
                <Money value={contractUpdatedAmount(c)} className="font-semibold" />
              </li>
            ))}
          </ul>
        ) : (
          <details className="card p-4">
            <summary className="tap flex cursor-pointer items-center font-medium text-accent">Registrar contrato assinado</summary>
            <form action={createContractAction} className="mt-3 space-y-3">
              <input type="hidden" name="quoteId" value={q.id} />
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium">Valor contratado (R$)</span>
                <input name="amount" inputMode="decimal" required defaultValue={q.amountKind === 'global' && q.amount !== null ? String(q.amount).replace('.', ',') : ''} className="field" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium">Data de assinatura</span>
                <input name="signedAt" type="date" className="field" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium">Documento do contrato</span>
                <input name="documentRef" className="field" placeholder="nome do arquivo ou link interno" />
              </label>
              <label className="tap flex items-start gap-3">
                <input type="checkbox" name="confirm" className="mt-0.5 h-5 w-5 accent-[#0e5a61]" />
                <span className="text-[14px]">Confirmo que há contrato assinado/aprovado para este valor.</span>
              </label>
              <button type="submit" className="btn btn-primary w-full">
                Registrar contrato
              </button>
            </form>
          </details>
        )}
      </Section>

      {history.length > 0 && (
        <Section title="Histórico">
          <ul className="card divide-y divide-line text-[13.5px]">
            {history.map((h) => (
              <li key={h.id} className="px-4 py-2.5">
                <div className="font-medium">
                  {h.field}: {h.oldValue} → {h.newValue}
                </div>
                <div className="text-muted">
                  {formatDateTime(h.at)} · {h.actor}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}
