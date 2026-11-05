import type { Metadata } from 'next'
import { BackButton } from '@/components/nav'
import { Badge, Banner, PageHeader } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { formatDate, formatPct } from '@/lib/format'

export const metadata: Metadata = { title: 'Cronograma' }

export default async function Cronograma() {
  const { ds } = await getReadyContext()
  const phases = [...new Set(ds.milestones.map((m) => m.phase))]
  const noDates = ds.milestones.every((m) => !m.plannedStart)
  return (
    <>
      <PageHeader back={<BackButton fallback="/mais" label="Mais" />} title="Cronograma de marcos" subtitle={`${ds.milestones.length} marcos em ${phases.length} fases`} />
      {noDates && <Banner tone="neutral">Nenhuma data lançada na planilha — o app não inventa datas. A programação deve ser aprovada e lançada na aba “Cronograma marcos”.</Banner>}
      {phases.map((ph) => (
        <section key={ph} className="mt-5">
          <h2 className="mb-2 px-1 text-[13px] font-semibold tracking-wide text-muted uppercase">{ph}</h2>
          <ul className="card divide-y divide-line">
            {ds.milestones
              .filter((m) => m.phase === ph)
              .map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="block text-[15px] font-medium">{m.title}</span>
                    <span className="text-[12.5px] text-muted">
                      {m.id} · {m.plannedStart ? `${formatDate(m.plannedStart)} – ${formatDate(m.plannedEnd)}` : 'Sem data'} {m.progress !== null ? `· ${formatPct(m.progress)}` : ''}
                    </span>
                  </span>
                  <Badge tone="gap">{m.status ?? '—'}</Badge>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  )
}
