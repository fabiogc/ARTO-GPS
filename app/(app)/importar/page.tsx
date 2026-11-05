import type { Metadata } from 'next'
import { applyWorkbookAction, uploadWorkbookAction } from '@/app/actions'
import { BackButton } from '@/components/nav'
import { Banner, FlashMessage, PageHeader, Section } from '@/components/ui'
import { previewImport, type Preview } from '@/lib/import/service'
import { requireAdmin } from '@/lib/session'

export const metadata: Metadata = { title: 'Importar planilha' }

const TABLE_LABEL: Record<string, string> = {
  items: 'Pacotes',
  categories: 'Macroetapas',
  quotes: 'Propostas',
  quote_items: 'Vínculos proposta–pacote',
  contracts: 'Contratos',
  contract_items: 'Vínculos contrato–pacote',
  measurements: 'Medições',
  scenarios: 'Cenários',
  pendencias: 'Pendências',
  milestones: 'Marcos',
  cashflow: 'Fluxo mensal',
  reference_values: 'Referências',
  suppliers: 'Fornecedores',
  projects: 'Projeto',
  source_records: 'Registros de origem',
  sheet_rows: 'Linhas da planilha (cópia)',
}

export default async function Importar({ searchParams }: { searchParams: Promise<{ arquivo?: string; nome?: string; ok?: string; erro?: string }> }) {
  await requireAdmin()
  const sp = await searchParams
  let preview: Preview | null = null
  let previewError: string | null = null
  if (sp.arquivo) {
    try {
      preview = await previewImport(sp.arquivo, sp.nome)
    } catch (e) {
      previewError = (e as Error).message
    }
  }
  const r = preview?.report

  return (
    <>
      <FlashMessage ok={sp.ok} erro={sp.erro ?? previewError ?? undefined} />
      <PageHeader back={<BackButton fallback="/mais" label="Mais" />} title="Importar planilha" subtitle="Nova versão da V4: simulação antes de aplicar" />

      {!r && (
        <form action={uploadWorkbookAction} className="card space-y-3 p-4" data-testid="upload-form">
          <p className="text-[14px] text-muted">O arquivo fica só no servidor (pasta privada). A planilha nunca é alterada. Edições feitas no app são preservadas.</p>
          <label className="block">
            <span className="mb-1 block text-[14px] font-medium">Planilha .xlsx (até 10 MB)</span>
            <input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className="field py-2.5" data-testid="upload-input" />
          </label>
          <button type="submit" className="btn btn-primary w-full" data-testid="upload-submit">
            Enviar e simular
          </button>
        </form>
      )}

      {r && preview && (
        <>
          <div className="card p-4" data-testid="import-preview">
            <div className="text-[12px] font-medium tracking-wide text-muted uppercase">Simulação</div>
            <div className="mt-1 text-[16px] font-semibold break-words">{r.source.file}</div>
            <div className="mt-1 text-[13px] text-muted">SHA-256 {r.source.sha256.slice(0, 16)}… · {r.source.sheets.length} abas</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                ['Pacotes', r.coverage.items],
                ['Propostas', r.counts.quotes],
                ['Contratos', r.counts.contracts],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-xl bg-paper py-2">
                  <div className="num text-[18px] font-semibold">{v}</div>
                  <div className="text-[12px] text-muted">{k}</div>
                </div>
              ))}
            </div>
          </div>

          {preview.errors.length > 0 ? (
            <div className="mt-4">
              <Banner tone="danger" title="Importação bloqueada — erros estruturais">
                <ul className="list-disc pl-5">
                  {preview.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Banner>
            </div>
          ) : (
            <>
              <Section title="O que muda no banco">
                {preview.changes === 0 ? (
                  <Banner tone="ok" testId="no-changes">Nenhuma alteração: este arquivo já está importado.</Banner>
                ) : (
                  <ul className="card divide-y divide-line text-[14px]" data-testid="import-changes">
                    {Object.entries(r.sync ?? {})
                      .filter(([, x]) => x.inserted + x.updated + x.removed > 0)
                      .map(([t, x]) => (
                        <li key={t} className="flex justify-between gap-3 px-4 py-2.5">
                          <span>{TABLE_LABEL[t] ?? t}</span>
                          <span className="num text-muted">
                            +{x.inserted} · ~{x.updated} · −{x.removed}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </Section>

              {r.conflicts && r.conflicts.length > 0 && (
                <Section title={`Conflitos com edições do app (${r.conflicts.length})`}>
                  <ul className="card divide-y divide-line text-[13.5px]">
                    {r.conflicts.map((k) => (
                      <li key={`${k.entity}${k.key}${k.field}`} className="px-4 py-2.5">
                        <strong>
                          {k.key} · {k.field}
                        </strong>
                        : manual {k.manual} · planilha nova {k.newImport}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title={`Divergências e alertas (${r.divergences.length + r.alerts.length})`}>
                <div className="card p-4 text-[13.5px] text-muted">
                  {r.divergences.length} divergência(s) e {r.alerts.length} alerta(s). Cobertura por proposta global: {r.coverage.itemsCoveredByComparableQuote} pacote(s); sem nenhum valor: {r.coverage.itemsWithoutAnyValue}. O relatório completo fica disponível após aplicar.
                </div>
              </Section>

              <Section title="Aplicar">
                <form action={applyWorkbookAction} className="card space-y-3 p-4" data-testid="apply-form">
                  <input type="hidden" name="arquivo" value={r.source.sha256} />
                  <input type="hidden" name="nome" value={r.source.file} />
                  {r.conflicts && r.conflicts.length > 0 && (
                    <fieldset className="space-y-1">
                      <legend className="mb-1 text-[14px] font-medium">Conflitos</legend>
                      {[
                        ['ask', 'Decidir depois, um a um (manter manual por enquanto)'],
                        ['keep-manual', 'Manter todas as edições do app'],
                        ['accept-import', 'Usar os valores da planilha'],
                      ].map(([v, l]) => (
                        <label key={v} className="tap flex items-center gap-3">
                          <input type="radio" name="resolucao" value={v} defaultChecked={v === 'ask'} className="h-5 w-5 accent-[#0e5a61]" />
                          <span className="text-[14px]">{l}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <label className="tap flex items-start gap-3">
                    <input type="checkbox" name="confirm" className="mt-0.5 h-5 w-5 accent-[#0e5a61]" data-testid="apply-confirm" />
                    <span className="text-[14px]">Confirmo a importação desta versão.</span>
                  </label>
                  <button type="submit" className="btn btn-primary w-full" disabled={preview.changes === 0} data-testid="apply-submit">
                    Aplicar importação
                  </button>
                </form>
                <a href="/importar" className="btn btn-secondary mt-3 w-full">
                  Enviar outro arquivo
                </a>
              </Section>
            </>
          )}
        </>
      )}
    </>
  )
}
