import type { Metadata } from 'next'
import Link from 'next/link'
import { BackButton } from '@/components/nav'
import { ScenarioForm } from '@/components/scenario-form'
import { Badge, Banner, FlashMessage, Money, PageHeader, Section } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { formatBRL, formatNumber, formatPct } from '@/lib/format'
import { norm } from '@/lib/import/rules'

export const metadata: Metadata = { title: 'Cenários e referências' }

export default async function Cenarios({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const sp = await searchParams
  const { ds, isAdmin } = await getReadyContext()
  const bdi = ds.references.find((r) => /bdi de sensibilidade/.test(norm(r.label)))?.value ?? null
  const research = ds.references.filter((r) => r.sheet === 'Pesquisa aprofundada V2')
  const physical = ds.references.filter((r) => r.sheet === 'V4 Base fisica e limites')

  return (
    <>
      <FlashMessage ok={sp.ok} erro={sp.erro} />
      <PageHeader back={<BackButton fallback="/mais" label="Mais" />} title="Cenários e referências" subtitle="Valores paramétricos e de pesquisa — não são orçamento" />

      <Section title="Alternativas estruturais (excludentes)">
        <Banner tone="warn" title="Nunca somar alternativas">
          Concreto, metálica e LSF são cenários mutuamente excludentes. Apenas um pode estar ativo; os pacotes das demais alternativas saem dos totais.
        </Banner>
        <ul className="mt-3 space-y-3" data-testid="scenario-list">
          {ds.scenarios.map((s) => {
            const pkgs = ds.items.filter((i) => i.scenario === s.id)
            return (
              <li key={s.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[16px] font-semibold">{s.name}</span>
                  {s.isActive ? <Badge tone="accent">Ativo</Badge> : <Badge tone="gap">Inativo</Badge>}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[14px]">
                  <dt className="text-muted">Custo direto paramétrico</dt>
                  <dd className="text-right font-semibold"><Money value={s.directCost} /></dd>
                  <dt className="text-muted">Com BDI de sensibilidade{bdi !== null ? ` (${formatPct(bdi)})` : ''}</dt>
                  <dd className="text-right"><Money value={s.directCost !== null && bdi !== null ? s.directCost * (1 + bdi) : null} empty="—" /></dd>
                  <dt className="text-muted">Comparabilidade</dt>
                  <dd className="text-right">{s.comparability}</dd>
                </dl>
                <p className="mt-2 text-[13px] text-muted">{s.notes}</p>
                <p className="mt-2 text-[13px]">
                  Pacotes desta alternativa:{' '}
                  {pkgs.map((p, i) => (
                    <span key={p.code}>
                      {i > 0 && ', '}
                      <Link href={`/itens/${p.code}`} className="font-medium text-accent">
                        {p.code}
                      </Link>
                    </span>
                  ))}
                  {pkgs.some((p) => p.scenarioInferred) && <span className="text-muted"> (vínculo inferido pela descrição)</span>}
                </p>
                <p className="mt-1 text-[12.5px] text-muted">Valor paramétrico agregado: não é atribuído a pacotes nem entra no custo conhecido.</p>
              </li>
            )
          })}
        </ul>
        {isAdmin && <ScenarioForm scenarios={ds.scenarios} returnTo="/cenarios" />}
      </Section>

      <Section title="Pesquisa aprofundada V2 (parcial)">
        <Banner tone="warn">Subtotais parciais, sem distribuição por pacote. Benchmarks por m² servem apenas como teste de plausibilidade.</Banner>
        <ul className="card mt-3 divide-y divide-line text-[14px]">
          {research.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium">{r.label}</span>
                <span className="shrink-0 text-right font-semibold">{fmtRef(r.value, r.unit, r.valueText)}</span>
              </div>
              <div className="mt-0.5 text-[12.5px] text-muted">
                {r.notes} · linha {r.sheetRow}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Base física (memorial)">
        <ul className="card divide-y divide-line text-[14px]">
          {physical.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-medium">{r.label}</span>
                <span className="text-[12.5px] text-muted">{r.notes}</span>
              </span>
              <span className="shrink-0 text-right font-semibold">{fmtRef(r.value, r.unit, r.valueText)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

function fmtRef(value: number | null, unit: string | null, text: string | null) {
  if (value === null) return text ?? '—'
  const u = norm(unit)
  if (u === 'r$') return formatBRL(value)
  if (u === 'fracao') return formatPct(value)
  if (u === 'r$/m2') return `${formatBRL(value)}/m²`
  if (u === 'r$/kg') return `${formatBRL(value)}/kg`
  if (u.startsWith('r$/m')) return `${formatBRL(value)}/${unit?.replace(/^R\$\//, '')}`
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
}
