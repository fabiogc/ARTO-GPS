import type { Metadata } from 'next'
import Link from 'next/link'
import { createMeasurementAction } from '@/app/actions'
import { BackButton } from '@/components/nav'
import { Banner, EmptyState, FlashMessage, Money, PageHeader, Section } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { contractUpdatedAmount, sumNullable, tracking } from '@/lib/finance'
import { formatBRL } from '@/lib/format'
import { requireAdmin } from '@/lib/session'

export const metadata: Metadata = { title: 'Estimado × contratado × realizado' }

export default async function Acompanhamento({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  const { units, ds } = await getReadyContext()
  const t = tracking(units)

  return (
    <>
      <FlashMessage ok={sp.ok} erro={sp.erro} />
      <PageHeader back={<BackButton fallback="/mais" label="Mais" />} title="Estimado × contratado × realizado" subtitle="Por pacote ou grupo de pacotes, sem duplicar valores" />
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Estimado (pré-contrato)', t.totals.estimated],
          ['Contratado', t.totals.contracted],
          ['Medido', t.totals.measured],
          ['Pago', t.totals.paid],
        ].map(([k, v]) => (
          <div key={String(k)} className="card p-4">
            <div className="text-[12px] font-medium tracking-wide text-muted uppercase">{k}</div>
            <div className="mt-1 text-[17px] font-semibold">
              <Money value={v as number | null} empty="—" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[13px] text-muted">
        Diferença contratado − estimado: {t.totals.comparablePairs ? `${formatBRL(t.totals.diff)} em ${t.totals.comparablePairs} pacote(s) com ambos os valores` : 'indisponível — nenhum pacote tem estimativa e contrato ao mesmo tempo'}.
      </p>

      <Section title="Por unidade de custo">
        {t.rows.length === 0 ? (
          <EmptyState title="Nada para comparar ainda">Nenhum pacote tem estimativa ou contrato.</EmptyState>
        ) : (
          <ul className="card divide-y divide-line" data-testid="tracking-list">
            {t.rows.map((r) => (
              <li key={r.unit.key} className="px-4 py-3">
                <Link href={`/itens/${r.unit.itemCodes[0]}`} className="font-medium text-ink underline-offset-2 active:underline">
                  {r.unit.itemCodes.length === 1 ? `${r.unit.itemCodes[0]} · ` : ''}
                  {r.unit.label}
                </Link>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-muted">Estimado</dt>
                  <dd className="text-right"><Money value={r.estimated} empty="—" /></dd>
                  <dt className="text-muted">Contratado</dt>
                  <dd className="text-right"><Money value={r.contracted} empty="Sem contrato" /></dd>
                  <dt className="text-muted">Medido / pago</dt>
                  <dd className="text-right"><Money value={r.measured} empty="—" /> / <Money value={r.paid} empty="—" /></dd>
                  <dt className="text-muted">Diferença</dt>
                  <dd className="text-right font-semibold"><Money value={r.diff} empty="—" /></dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Contratos (${ds.contracts.length})`}>
        {ds.contracts.length === 0 ? (
          <Banner tone="neutral">Nenhum contrato registrado. Registre a partir de uma proposta (Propostas › proposta › Registrar contrato).</Banner>
        ) : (
          <ul className="space-y-3">
            {ds.contracts.map((c) => {
              const meas = ds.measurements.filter((m) => m.contractId === c.id)
              return (
                <li key={c.id} className="card p-4">
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold">{c.id}</span>
                    <Money value={contractUpdatedAmount(c)} className="font-semibold" />
                  </div>
                  <div className="text-[13px] text-muted">
                    {c.supplier} · {c.object} · pacotes {c.itemCodes.join(', ')}
                  </div>
                  <div className="mt-1 text-[13px]">
                    Medido <Money value={sumNullable(meas.map((m) => m.measured))} empty="—" /> · Pago <Money value={sumNullable(meas.map((m) => m.paid))} empty="—" />
                  </div>
                  <details className="mt-2">
                    <summary className="tap flex cursor-pointer items-center text-[14px] font-medium text-accent">Lançar medição / pagamento</summary>
                    <form action={createMeasurementAction} className="mt-2 grid grid-cols-2 gap-2">
                      <input type="hidden" name="contractId" value={c.id} />
                      <input name="period" placeholder="Período (2027-01)" required className="field col-span-2" />
                      <input name="measured" inputMode="decimal" placeholder="Medido R$" className="field" />
                      <input name="paid" inputMode="decimal" placeholder="Pago R$" className="field" />
                      <button type="submit" className="btn btn-primary col-span-2">
                        Salvar medição
                      </button>
                    </form>
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </>
  )
}
