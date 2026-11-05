import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Badge, Banner, Bar, FlashMessage, Kpi, Money, PageHeader, Section } from '@/components/ui'
import { ScenarioForm } from '@/components/scenario-form'
import { getReadyContext } from '@/lib/data'
import { isQuoteComparable } from '@/lib/finance'
import { formatBRL, formatBRLCompact, formatDate, formatDateTime, formatNumber, formatPct } from '@/lib/format'
import { norm } from '@/lib/import/rules'
import { ESTIMATE_SOURCE_LABEL } from '@/lib/labels'

export default async function Overview({ searchParams }: { searchParams: Promise<{ negado?: string; ok?: string; erro?: string }> }) {
  const sp = await searchParams
  const { ds, summary: s, cats, isAdmin } = await getReadyContext()
  const p = ds.project
  const active = ds.scenarios.find((x) => x.isActive)
  const comparable = ds.quotes.filter(isQuoteComparable).length
  const withValue = cats.filter((c) => c.subtotal !== null).sort((a, b) => (b.subtotal ?? 0) - (a.subtotal ?? 0))
  const max = withValue[0]?.subtotal ?? null
  const research = ds.references.find((r) => r.sheet === 'Pesquisa aprofundada V2' && /bdi e contingencia/.test(norm(r.label)))

  return (
    <>
      <FlashMessage ok={sp.ok} erro={sp.negado ? 'Acesso restrito ao administrador.' : sp.erro} />
      <PageHeader
        title={p.name}
        subtitle={
          <>
            {p.fullName} · {formatNumber(p.areaM2)} m² construídos
            <br />
            Dados importados em {formatDateTime(p.importedAt)} · projeto-base {formatDate(p.baseDate)} · {p.version}
          </>
        }
      />

      <Banner tone="warn" testId="coverage-banner">
        <strong>Orçamento em desenvolvimento — cobertura {formatPct(s.coverage)}.</strong> {s.coveredItems} de {s.inScopeItems} pacotes no escopo têm algum valor. Custo total do hospital: <strong>não apurado</strong>.
      </Banner>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Kpi
          testId="kpi-known"
          label="Custo conhecido"
          value={<Money value={s.estimateTotal} empty="Não precificado" />}
          hint={
            s.estimateTotal === null ? (
              'Nenhum pacote com valor'
            ) : (
              <>
                {s.coveredItems}/{s.inScopeItems} pacotes ·{' '}
                {Object.entries(s.estimateBySource)
                  .filter(([, v]) => v !== null)
                  .map(([k]) => ESTIMATE_SOURCE_LABEL[k as keyof typeof ESTIMATE_SOURCE_LABEL].toLowerCase())
                  .join(', ')}
              </>
            )
          }
        />
        <Kpi testId="kpi-contracted" label="Contratado" value={<Money value={s.contractedTotal} empty="Sem contratos" />} hint={s.contractCount ? `${s.contractCount} contrato(s)` : 'Nenhum contrato registrado'} />
        <Kpi testId="kpi-paid" label="Pago" value={<Money value={s.paidTotal} empty="Sem pagamentos" />} hint={s.measuredTotal !== null ? `Medido ${formatBRL(s.measuredTotal)}` : 'Nenhuma medição registrada'} />
        <Kpi testId="kpi-unpriced" label="Pacotes sem preço" value={<span className="num">{s.unpricedItems}</span>} hint={`de ${s.inScopeItems} no escopo do cenário`} />
      </div>

      <Section title="Camadas do orçamento (não se somam)">
        <div className="card divide-y divide-line">
          <LayerRow letter="A" title="Orçamento de referência" detail={`${s.referencePricedItems} de ${s.inScopeItems} pacotes com quantidade × preço`} value={<Money value={s.referenceTotal} />} />
          <LayerRow
            letter="B"
            title="Propostas de fornecedores"
            detail={`${s.quoteCount} registradas · ${comparable} com valor global comparável · ${s.quotesExcluded} fora dos totais (tarifas, opcionais, sem valor ou vínculo divergente)`}
            value={<Money value={s.estimateBySource.proposta} empty="—" />}
            href={isAdmin ? '/propostas' : undefined}
          />
          <LayerRow letter="C" title="Contratos e medições" detail={s.contractCount ? `${s.contractCount} contrato(s)` : 'Nenhum contrato registrado na planilha'} value={<Money value={s.contractedTotal} empty="—" />} href={isAdmin ? '/acompanhamento' : undefined} />
        </div>
        <p className="mt-2 px-1 text-[13px] leading-snug text-muted">
          Custo conhecido = por pacote, contrato › proposta de referência › orçamento-base (uma fonte por pacote). Propostas concorrentes nunca são somadas.
        </p>
      </Section>

      <Section title="Escopo e indicadores">
        <div className="card divide-y divide-line text-[14.5px]">
          <Row k="Cenário estrutural ativo" v={active ? active.name : 'Nenhum — alternativas fora dos totais'} />
          <Row k="Pacotes fora do escopo (alternativas inativas)" v={String(s.excludedByScenario)} />
          <Row k="Sem equipamentos médicos" v={<Money value={s.estimateTotalExclMedicalEquipment} />} />
          <Row k="Equipamentos médicos" v={`${s.medicalEquipmentItems} pacotes · cenário à parte`} />
          <Row
            k="Custo/m² sobre o conhecido"
            v={
              s.coverage < 0.5 ? (
                <span className="text-muted">
                  Não significativo <Badge tone="gap">cobertura {formatPct(s.coverage)}</Badge>
                </span>
              ) : (
                `${formatBRL(s.knownCostPerM2)}/m²`
              )
            }
          />
        </div>
        {isAdmin && <ScenarioForm scenarios={ds.scenarios} returnTo="/" />}
      </Section>

      <Section title="Macroetapas com valor" action={<Link href="/custos" className="tap inline-flex items-center text-[14px] font-medium text-accent">Todas <ChevronRight size={16} /></Link>}>
        {withValue.length === 0 ? (
          <div className="card p-4 text-[14px] text-muted">Nenhuma macroetapa tem valor ainda.</div>
        ) : (
          <div className="card divide-y divide-line">
            {withValue.slice(0, 5).map((c) => (
              <Link key={c.code} href={`/custos/${c.code}`} className="tap block px-4 py-3 active:bg-[#f1f0ec]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] font-medium">
                    <span className="num mr-1.5 text-muted">{c.code}</span>
                    {c.name}
                  </span>
                  <Money value={c.subtotal} className="text-[15px] font-semibold" />
                </div>
                <div className="mt-2">
                  <Bar value={c.subtotal} max={max} />
                </div>
                <div className="mt-1 text-[12.5px] text-muted">
                  {c.pricedCount} de {c.inScopeCount} pacotes com valor · {formatPct(c.pctOfKnown)} do conhecido
                </div>
              </Link>
            ))}
          </div>
        )}
        <p className="mt-2 px-1 text-[13px] text-muted">
          {cats.length - withValue.length} de {cats.length} macroetapas ainda sem nenhum valor.
        </p>
      </Section>

      <Section title="Atenção">
        <Banner tone="neutral">
          O subtotal de pesquisa da V2{research?.value ? ` (≈ ${formatBRLCompact(research.value)}, com BDI e contingência de sensibilidade)` : ''} é <strong>parcial</strong> e não está distribuído pelos pacotes. Não representa o custo do hospital. Detalhes em <Link href="/cenarios" className="font-semibold text-accent underline">Cenários e referências</Link>.
        </Banner>
      </Section>
    </>
  )
}

function LayerRow({ letter, title, detail, value, href }: { letter: string; title: string; detail: string; value: React.ReactNode; href?: string }) {
  const body = (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-white">{letter}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-medium">{title}</span>
          <span className="text-right text-[15px] font-semibold">{value}</span>
        </div>
        <div className="mt-0.5 text-[13px] leading-snug text-muted">{detail}</div>
      </div>
      {href && <ChevronRight size={18} className="mt-1 shrink-0 text-muted" aria-hidden />}
    </div>
  )
  return href ? (
    <Link href={href} className="tap block active:bg-[#f1f0ec]">
      {body}
    </Link>
  ) : (
    body
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-muted">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  )
}
