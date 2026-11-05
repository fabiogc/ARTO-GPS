import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { updateItemAction } from '@/app/actions'
import { BackButton } from '@/components/nav'
import { Badge, Banner, Facts, FlashMessage, Money, PageHeader, Section } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { contractUpdatedAmount, isInScope, quoteExclusionReason, referenceTotal } from '@/lib/finance'
import { formatBRL, formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { CONFIDENCE_LABEL, ESTIMATE_SOURCE_LABEL, PRICE_TYPE_LABEL, QUOTE_STATUS_LABEL, SCENARIO_LABEL, quoteAmountLabel } from '@/lib/labels'
import { auditFor, rawSheetRow, sourceRecordsFor } from '@/lib/repo'

export async function generateMetadata({ params }: { params: Promise<{ codigo: string }> }): Promise<Metadata> {
  return { title: `Pacote ${(await params).codigo}` }
}

export default async function ItemPage({ params, searchParams }: { params: Promise<{ codigo: string }>; searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const { codigo } = await params
  const sp = await searchParams
  const { ds, unitByItem, opts, isAdmin } = await getReadyContext()
  const item = ds.items.find((i) => i.code === decodeURIComponent(codigo))
  if (!item) notFound()
  const unit = unitByItem.get(item.code)
  const inScope = isInScope(item, opts.activeScenario)
  const ref = referenceTotal(item)
  const quotes = ds.quotes.filter((q) => q.itemCodes.includes(item.code) || q.packageRaw === item.code)
  const contracts = ds.contracts.filter((c) => c.itemCodes.includes(item.code))
  const sources = sourceRecordsFor('item', item.code)
  const history = auditFor('item', [item.code])
  const raw = isAdmin && item.sheetRow ? rawSheetRow('Orcamento detalhado', item.sheetRow) : null
  const grouped = unit && unit.itemCodes.length > 1
  const cat = ds.categories.find((c) => c.code === item.group)

  return (
    <>
      <FlashMessage ok={sp.ok} erro={sp.erro} />
      <PageHeader
        back={<BackButton fallback={`/custos/${item.group}`} label={cat?.name ?? 'Macroetapa'} />}
        title={item.description}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="num">{item.code}</span> · {cat?.name}
            {item.edited.length > 0 && <Badge tone="ok">Editado no app</Badge>}
          </span>
        }
      />

      {!inScope && (
        <div className="mb-4">
          <Banner tone="gap" title="Fora do cenário ativo">
            Este pacote pertence a “{SCENARIO_LABEL[item.scenario]}”. Alternativas estruturais são excludentes e só entram nos totais quando o cenário correspondente está ativo.
          </Banner>
        </div>
      )}

      <div className="card p-4" data-testid="item-estimate">
        <div className="text-[12px] font-medium tracking-wide text-muted uppercase">Estimativa atual</div>
        {grouped ? (
          <>
            <div className="mt-1 text-[16px] font-semibold">Incluído em proposta global de {unit!.itemCodes.length} pacotes</div>
            <div className="mt-1 text-[14px] text-muted">
              Valor do grupo: <Money value={unit!.estimate} className="font-semibold text-ink" /> — sem rateio por pacote (a proposta não traz composição por disciplina).
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unit!.itemCodes.map((c) => (
                <Link key={c} href={`/itens/${c}`} className="tap inline-flex items-center rounded-full border border-line-strong px-3 text-[13px] font-medium text-ink-2">
                  {c}
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-1 text-[22px] font-semibold">
            <Money value={unit?.estimate ?? null} />
          </div>
        )}
        <div className="mt-2 text-[13px] text-muted">
          {unit?.estimateSource ? `Fonte: ${ESTIMATE_SOURCE_LABEL[unit.estimateSource]}${unit.estimateSource === 'proposta' ? ' — valor de proposta não é contrato.' : ''}` : 'Sem orçamento de referência, proposta comparável ou contrato.'}
        </div>
      </div>

      <Section title="Orçamento de referência (camada A)">
        <Facts
          rows={[
            ['Unidade', item.unit],
            ['Quantidade', item.quantity === null ? <span className="font-normal text-gap italic">Não informada</span> : `${formatNumber(item.quantity)} (estimada — não é medição executiva)`],
            ['Preço unitário', <Money key="u" value={item.unitPrice} />],
            ['Total de referência', <Money key="t" value={ref} />],
            ['Tipo de preço', item.priceType ? PRICE_TYPE_LABEL[item.priceType] : null],
            ['Data-base', item.priceDate ? formatDate(item.priceDate) : null],
            ['Fonte', item.source],
            ['Confiabilidade', item.confidence ? CONFIDENCE_LABEL[item.confidence] : null],
            ['Situação', item.status],
            ['Cotação (planilha)', item.quoteStatusRaw],
            ['Cenário', <>{SCENARIO_LABEL[item.scenario]}{item.scenarioInferred && <span className="block text-[12px] font-normal text-muted">inferido pela descrição — revisar</span>}</>],
            ['Tipo de custo', item.costKind === 'equipamento_medico' ? 'Equipamento médico (cenário à parte)' : item.costKind === 'contingencia' ? 'Contingência / reserva' : 'Custo direto'],
          ]}
        />
      </Section>

      {isAdmin ? (
        <Section title={`Propostas (${quotes.length})`}>
          {quotes.length === 0 ? (
            <div className="card p-4 text-[14px] text-muted">Nenhuma proposta registrada para este pacote.</div>
          ) : (
            <ul className="card divide-y divide-line" data-testid="item-quotes">
              {quotes.map((q) => {
                const reason = quoteExclusionReason(q)
                const chosen = unit?.chosenQuote?.id === q.id
                return (
                  <li key={q.id}>
                    <Link href={`/propostas/${encodeURIComponent(q.id)}`} className="tap block px-4 py-3 active:bg-[#f1f0ec]" data-testid={`item-quote-${q.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[15px] font-medium">{q.supplier ?? 'Fornecedor não informado'}</span>
                        <span className="text-right text-[14.5px] font-semibold">{quoteAmountLabel(q)}</span>
                      </div>
                      <div className="mt-0.5 text-[13px] text-muted">{q.service}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                        {q.isVerbal && <Badge tone="warn">Informado verbalmente</Badge>}
                        {q.isInternal && <Badge tone="accent">Interna ARTO</Badge>}
                        {chosen && <Badge tone="accent">Usada na estimativa</Badge>}
                        {reason && <Badge tone="gap">{reason}</Badge>}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          {quotes.length > 1 && <p className="mt-2 px-1 text-[13px] text-muted">Propostas concorrentes não são somadas: no máximo uma compõe a estimativa.</p>}
        </Section>
      ) : (
        quotes.length > 0 && (
          <Section title="Propostas">
            <div className="card p-4 text-[14px] text-muted">{quotes.length} proposta(s) em análise pela equipe ARTO.</div>
          </Section>
        )
      )}

      <Section title="Contrato e medições (camada C)">
        {contracts.length === 0 ? (
          <div className="card p-4 text-[14px] text-muted">Nenhum contrato registrado.</div>
        ) : (
          <ul className="card divide-y divide-line">
            {contracts.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{c.id}</span>
                  <Money value={contractUpdatedAmount(c)} className="font-semibold" />
                </div>
                <div className="text-[13px] text-muted">
                  {isAdmin ? c.supplier : null} · {c.signedAt ? formatDate(c.signedAt) : 'sem data'} · {c.origin === 'manual' ? 'lançado no app' : 'planilha'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Origem e notas">
        <div className="card space-y-2 p-4 text-[14px]">
          {sources.map((s) => (
            <div key={s.sheet + s.row}>
              Planilha V4 · aba <strong>{s.sheet}</strong> · linha <strong>{s.row}</strong>
            </div>
          ))}
          {item.docLink && <div>Documento: {item.docLink}</div>}
          <div className="text-muted">{item.notes ?? 'Sem observações.'}</div>
          {raw && (
            <details className="pt-1">
              <summary className="tap flex cursor-pointer items-center font-medium text-accent">Ver linha original da planilha</summary>
              <ul className="mt-2 space-y-1 text-[12.5px] text-ink-2">
                {Object.entries(raw).map(([col, c]) => (
                  <li key={col} className="break-words">
                    <strong>{col}</strong>: {c.f ? <code>={c.f}</code> : String(c.v)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Section>

      <Section title="Histórico">
        {history.length === 0 ? (
          <div className="card p-4 text-[14px] text-muted">Sem alterações desde a importação.</div>
        ) : (
          <ul className="card divide-y divide-line text-[13.5px]" data-testid="item-history">
            {history.map((h) => (
              <li key={h.id} className="px-4 py-2.5">
                <div className="font-medium">
                  {h.field}: {fmtJson(h.oldValue)} → {fmtJson(h.newValue)}
                </div>
                <div className="text-muted">
                  {formatDateTime(h.at)} · {h.actor}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {isAdmin && (
        <Section title="Editar orçamento de referência">
          <details className="card p-4" data-testid="item-edit">
            <summary className="tap flex cursor-pointer items-center font-medium text-accent">Lançar ou corrigir valores</summary>
            <form action={updateItemAction} className="mt-3 space-y-3">
              <input type="hidden" name="code" value={item.code} />
              <p className="text-[13px] text-muted">A edição fica registrada no histórico e sobrevive a reimportações; a planilha original não é alterada. Deixe vazio para “não informado”.</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantidade" name="quantity" defaultValue={item.quantity === null ? '' : String(item.quantity).replace('.', ',')} inputMode="decimal" />
                <Field label="Preço unitário (R$)" name="unitPrice" defaultValue={item.unitPrice === null ? '' : String(item.unitPrice).replace('.', ',')} inputMode="decimal" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium">Tipo de preço</span>
                  <select name="priceType" defaultValue={item.priceType ?? ''} className="field">
                    <option value="">—</option>
                    {Object.entries(PRICE_TYPE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="Data-base" name="priceDate" type="date" defaultValue={item.priceDate ?? ''} />
              </div>
              <Field label="Fonte" name="source" defaultValue={item.source ?? ''} />
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium">Confiabilidade</span>
                  <select name="confidence" defaultValue={item.confidence ?? ''} className="field">
                    <option value="">—</option>
                    <option value="alta">Alta</option>
                    <option value="media">Média</option>
                    <option value="baixa">Baixa</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-medium">Cenário</span>
                  <select name="scenario" defaultValue={item.scenario} className="field">
                    {Object.entries(SCENARIO_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Field label="Situação" name="status" defaultValue={item.status} />
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium">Observações</span>
                <textarea name="notes" defaultValue={item.notes ?? ''} rows={3} className="field" />
              </label>
              {ref !== null && <p className="text-[13px] text-muted">Total atual: {formatBRL(ref)}</p>}
              <button type="submit" className="btn btn-primary w-full">
                Salvar
              </button>
            </form>
          </details>
        </Section>
      )}
    </>
  )
}

function Field(props: { label: string; name: string; defaultValue?: string; type?: string; inputMode?: 'decimal' }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium">{props.label}</span>
      <input name={props.name} type={props.type ?? 'text'} inputMode={props.inputMode} defaultValue={props.defaultValue} className="field" />
    </label>
  )
}

function fmtJson(v: string | null) {
  if (v === null) return '—'
  try {
    const x = JSON.parse(v)
    if (x === null) return 'vazio'
    return typeof x === 'number' ? formatNumber(x) : typeof x === 'object' ? JSON.stringify(x) : String(x)
  } catch {
    return v
  }
}
