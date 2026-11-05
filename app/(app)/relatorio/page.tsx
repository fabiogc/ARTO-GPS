import type { Metadata } from 'next'
import { resolveConflictAction } from '@/app/actions'
import { BackButton } from '@/components/nav'
import { Banner, FlashMessage, PageHeader, Section } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { formatDateTime, formatPct } from '@/lib/format'
import { lastImportReport, openConflicts } from '@/lib/repo'
import { requireAdmin } from '@/lib/session'

export const metadata: Metadata = { title: 'Relatório de importação' }

export default async function Relatorio({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  const { summary: s } = await getReadyContext()
  const last = lastImportReport()
  const conflicts = openConflicts()
  if (!last) return <Banner tone="warn">Nenhuma importação registrada.</Banner>
  const r = last.report
  const c = r.coverage

  return (
    <>
      <FlashMessage ok={sp.ok} erro={sp.erro} />
      <PageHeader back={<BackButton fallback="/mais" label="Mais" />} title="Relatório de importação" subtitle={`${r.source.file} · ${formatDateTime(last.at)} · SHA-256 ${r.source.sha256.slice(0, 12)}…`} />

      {conflicts.length > 0 && (
        <Section title={`Conflitos com edições manuais (${conflicts.length})`}>
          <ul className="space-y-2">
            {conflicts.map((k) => (
              <li key={String(k.id)} className="card p-4 text-[14px]">
                <div className="font-semibold">
                  {String(k.entity_type)} {String(k.entity_key)} · {String(k.field)}
                </div>
                <div className="mt-1 text-muted">
                  Manual: {String(k.manual_value)} · planilha anterior: {String(k.previous_import_value)} · planilha nova: {String(k.new_import_value)}
                </div>
                <form action={resolveConflictAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="id" value={String(k.id)} />
                  <button name="decision" value="keep-manual" className="btn btn-secondary flex-1">
                    Manter manual
                  </button>
                  <button name="decision" value="accept-import" className="btn btn-primary flex-1">
                    Usar planilha
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Cobertura (estado atual)">
        <div className="card divide-y divide-line text-[14.5px]" data-testid="coverage-report">
          {[
            ['Pacotes totais', String(s.totalItems)],
            ['No escopo do cenário', String(s.inScopeItems)],
            ['Com orçamento de referência (A)', String(s.referencePricedItems)],
            ['Com algum valor (A, proposta ou contrato)', `${s.coveredItems} (${formatPct(s.coverage)})`],
            ['Sem preço', String(s.unpricedItems)],
            ['Propostas registradas', String(s.quoteCount)],
            ['Propostas fora dos totais', String(s.quotesExcluded)],
            ['Propostas sem pacote / vínculo divergente', String(c.quotesWithoutItem.length)],
            ['Contratos', String(s.contractCount)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-4 py-2.5">
              <span className="text-muted">{k}</span>
              <span className="num font-semibold">{v}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Propostas sem pacote associado">
        <List items={c.quotesWithoutItem.map((q) => `${q.id} (${q.packageRaw ?? '—'}): ${q.reason}`)} />
      </Section>
      <Section title="Propostas não somadas">
        <List items={c.quotesNotSummed.map((q) => `${q.id}: ${q.reason}`)} />
      </Section>
      <Section title={`Alertas (${r.alerts.length})`}>
        <List items={r.alerts} />
      </Section>
      <Section title={`Divergências (${r.divergences.length})`}>
        <List items={r.divergences.map((d) => `${d.sheet ? `${d.sheet}${d.row ? ` L${d.row}` : ''}: ` : ''}${d.message}`)} />
      </Section>
      <Section title="Valores fora da lista de validação">
        <List items={r.outOfValidation.map((o) => `${o.sheet} L${o.row} · ${o.field}: “${o.value}”`)} />
      </Section>
      <Section title={`Fontes citadas (${r.sources.length})`}>
        <List items={r.sources.map((x) => `${x.kind} ${x.ref}: ${x.source}`)} />
      </Section>
      {r.legacyDiff && (
        <Section title="Protótipo anterior (JSON) × V4">
          <List items={[`${r.legacyDiff.compared} registros comparados · ${r.legacyDiff.differences.length} diferenças · só no JSON: ${r.legacyDiff.onlyLegacy.length} · só na V4: ${r.legacyDiff.onlyV4.length}`, ...r.legacyDiff.differences.slice(0, 30).map((d) => `${d.id}.${d.field}: JSON=${JSON.stringify(d.legacy)} · V4=${JSON.stringify(d.v4)}`)]} />
        </Section>
      )}
      <Section title="Sincronização da última importação">
        <List items={Object.entries(r.sync ?? {}).map(([t, x]) => `${t}: +${x.inserted} · ~${x.updated} · −${x.removed} · =${x.unchanged}`)} />
      </Section>
      <Section title="Avisos técnicos">
        <List items={r.issues.map((i) => `[${i.level}] ${i.sheet ?? ''}${i.row ? ` L${i.row}` : ''}: ${i.message}`)} />
      </Section>
    </>
  )
}

function List({ items }: { items: string[] }) {
  if (!items.length) return <div className="card p-4 text-[14px] text-muted">Nenhum.</div>
  return (
    <ul className="card divide-y divide-line text-[13.5px] leading-snug">
      {items.map((t, i) => (
        <li key={i} className="px-4 py-2.5 break-words">
          {t}
        </li>
      ))}
    </ul>
  )
}
