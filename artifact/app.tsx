/**
 * Versão de TESTE da interface, publicada como página no claude.ai.
 * Reaproveita o núcleo financeiro do app (lib/finance.ts) e recebe os dados
 * importados da V4 por `window.__ARTO_DATA__` (injetado no build, fora do git).
 * Somente leitura: edições, contratos e reimportação existem na versão servidor.
 */
import { BarChart3, ChevronLeft, ChevronRight, FileText, Home, ListTree, MoreHorizontal, Search, TriangleAlert } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  abcFromUnits,
  buildCostUnits,
  categorySummaries,
  contractUpdatedAmount,
  isInScope,
  isQuoteComparable,
  quoteExclusionReason,
  referenceTotal,
  summarize,
  tracking,
  type AbcBase,
  type AbcMode,
  type CalcOptions,
  type CostUnit,
} from '../lib/finance'
import { NOT_PRICED, formatBRL, formatBRLCompact, formatDate, formatDateTime, formatNumber, formatPct } from '../lib/format'
import { CATEGORY_RISK, norm, pendenciaRiskTier } from '../lib/import/rules'
import { AMOUNT_KIND_LABEL, CONFIDENCE_LABEL, ESTIMATE_SOURCE_LABEL, PRICE_TYPE_LABEL, QUOTE_STATUS_LABEL, QUOTE_STATUS_ORDER, SCENARIO_LABEL, quoteAmountLabel } from '../lib/labels'
import type { Dataset, Quote, QuoteStatus, Role, StructuralScenario } from '../lib/types'
import { clientView } from '../lib/visibility'

interface Snapshot {
  dataset: Dataset
  report: null | { at: string; divergences: Array<{ message: string; sheet?: string; row?: number }>; alerts: string[]; quotesWithoutItem: Array<{ id: string; reason: string }> }
  generatedAt: string
}
const SNAP = (window as unknown as { __ARTO_DATA__: Snapshot }).__ARTO_DATA__

// ---------------------------------------------------------------- utilidades
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* armazenamento indisponível: segue sem lembrar a preferência */
    }
  },
}
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ')
const itemHash = (code: string) => `item-${code.replace('.', '-')}`
const codeFromHash = (h: string) => h.replace(/^item-/, '').replace('-', '.')

// ---------------------------------------------------------------- roteamento (âncoras simples: #custos-01, #item-01-011)
function useRoute(): string {
  const [r, setR] = useState(() => location.hash.slice(1))
  useEffect(() => {
    const on = () => {
      setR(location.hash.slice(1))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return r
}
let depth = 0
window.addEventListener('hashchange', () => {
  depth++
})
function back(fallback: string) {
  if (depth > 0) {
    depth -= 2 // o próprio "voltar" gera um hashchange
    history.back()
  } else location.hash = fallback
}

// ---------------------------------------------------------------- componentes base
function Money({ value, empty = NOT_PRICED, className }: { value: number | null | undefined; empty?: string; className?: string }) {
  if (value === null || value === undefined) return <span className={cx('missing', className)}>{empty}</span>
  return <span className={cx('num', className)}>{formatBRL(value)}</span>
}
type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'ok' | 'gap'
function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`badge t-${tone}`}>{children}</span>
}
function Banner({ children, tone = 'neutral', title }: { children: React.ReactNode; tone?: Tone; title?: string }) {
  return (
    <div role="note" className={`banner t-${tone}`}>
      {title && <strong className="block">{title}</strong>}
      {children}
    </div>
  )
}
function Header({ title, subtitle, backTo, backLabel }: { title: string; subtitle?: React.ReactNode; backTo?: string; backLabel?: string }) {
  return (
    <header className="page-head">
      {backTo && (
        <button type="button" className="back" onClick={() => back(backTo)}>
          <ChevronLeft size={22} aria-hidden /> {backLabel ?? 'Voltar'}
        </button>
      )}
      <h1>{title}</h1>
      {subtitle && <div className="sub">{subtitle}</div>}
    </header>
  )
}
function Section({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="section">
      {title && (
        <div className="section-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}
function Bar({ value, max }: { value: number | null; max: number | null }) {
  if (value === null || !max) return <div className="bar gap" aria-label="sem valor" />
  return (
    <div className="bar" aria-hidden>
      <div style={{ width: `${Math.max(2, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  )
}
function Coverage({ done, total }: { done: number; total: number }) {
  return (
    <div className="coverage" aria-label={`${done} de ${total} com valor`}>
      <div className="track">
        <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <span className="num">
        {done}/{total}
      </span>
    </div>
  )
}
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button type="button" key={v} aria-pressed={v === value} className={cx(v === value && 'on')} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}
function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string, number?]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(([v, l, n]) => (
        <button type="button" key={v} aria-pressed={v === value} className={cx('chip', v === value && 'on')} onClick={() => onChange(v)}>
          {l}
          {n !== undefined && <span className="num count">{n}</span>}
        </button>
      ))}
    </div>
  )
}
function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="card facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v ?? <span className="missing">Não informado</span>}</dd>
        </div>
      ))}
    </dl>
  )
}
function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="row" href={`#${href}`}>
      {children}
    </a>
  )
}
function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- contexto
interface Ctx {
  ds: Dataset
  role: Role
  isAdmin: boolean
  opts: CalcOptions
  units: CostUnit[]
  unitByItem: Map<string, CostUnit>
  summary: ReturnType<typeof summarize>
  cats: ReturnType<typeof categorySummaries>
  scenario: StructuralScenario | null
  setScenario: (s: StructuralScenario | null) => void
  quoteHash: (q: Quote) => string
}
const C = React.createContext<Ctx>(null as unknown as Ctx)
const useCtx = () => React.useContext(C)

// ---------------------------------------------------------------- telas
function Overview() {
  const { ds, summary: s, cats, isAdmin, setScenario, scenario } = useCtx()
  const p = ds.project
  const withValue = cats.filter((c) => c.subtotal !== null).sort((a, b) => (b.subtotal ?? 0) - (a.subtotal ?? 0))
  const max = withValue[0]?.subtotal ?? null
  const research = ds.references.find((r) => r.sheet === 'Pesquisa aprofundada V2' && /bdi e contingencia/.test(norm(r.label)))
  const comparable = ds.quotes.filter(isQuoteComparable).length
  return (
    <>
      <Header
        title={p.name}
        subtitle={
          <>
            {p.fullName} · {formatNumber(p.areaM2)} m² construídos
            <br />
            Dados de {formatDateTime(p.importedAt)} · projeto-base {formatDate(p.baseDate)}
          </>
        }
      />
      <Banner tone="warn">
        <strong>Orçamento em desenvolvimento — cobertura {formatPct(s.coverage)}.</strong> {s.coveredItems} de {s.inScopeItems} pacotes no escopo têm algum valor. Custo total do hospital: <strong>não apurado</strong>.
      </Banner>
      <div className="grid2 mt">
        <Kpi
          label="Custo conhecido"
          value={<Money value={s.estimateTotal} />}
          hint={
            s.estimateTotal === null
              ? 'Nenhum pacote com valor'
              : `${s.coveredItems}/${s.inScopeItems} pacotes · ${Object.entries(s.estimateBySource)
                  .filter(([, v]) => v !== null)
                  .map(([k]) => ESTIMATE_SOURCE_LABEL[k as keyof typeof ESTIMATE_SOURCE_LABEL].toLowerCase())
                  .join(', ')}`
          }
        />
        <Kpi label="Contratado" value={<Money value={s.contractedTotal} empty="Sem contratos" />} hint={s.contractCount ? `${s.contractCount} contrato(s)` : 'Nenhum contrato registrado'} />
        <Kpi label="Pago" value={<Money value={s.paidTotal} empty="Sem pagamentos" />} hint={s.measuredTotal !== null ? `Medido ${formatBRL(s.measuredTotal)}` : 'Nenhuma medição registrada'} />
        <Kpi label="Pacotes sem preço" value={<span className="num">{s.unpricedItems}</span>} hint={`de ${s.inScopeItems} no escopo do cenário`} />
      </div>

      <Section title="Camadas do orçamento (não se somam)">
        <div className="card list">
          <Layer letter="A" title="Orçamento de referência" detail={`${s.referencePricedItems} de ${s.inScopeItems} pacotes com quantidade × preço`} value={<Money value={s.referenceTotal} />} />
          <Layer
            letter="B"
            title="Propostas de fornecedores"
            detail={isAdmin ? `${s.quoteCount} registradas · ${comparable} com valor global comparável · ${s.quotesExcluded} fora dos totais` : `${s.quoteCount} proposta(s) em análise pela ARTO`}
            value={<Money value={s.estimateBySource.proposta} empty="—" />}
            href={isAdmin ? 'propostas' : undefined}
          />
          <Layer letter="C" title="Contratos e medições" detail={s.contractCount ? `${s.contractCount} contrato(s)` : 'Nenhum contrato registrado'} value={<Money value={s.contractedTotal} empty="—" />} />
        </div>
        <p className="note">Custo conhecido = por pacote, contrato › proposta de referência › orçamento-base (uma fonte por pacote). Propostas concorrentes nunca são somadas.</p>
      </Section>

      <Section title="Escopo e indicadores">
        <div className="card list kv">
          <KV k="Cenário estrutural ativo" v={ds.scenarios.find((x) => x.id === scenario)?.name ?? 'Nenhum — alternativas fora dos totais'} />
          <KV k="Pacotes fora do escopo (alternativas)" v={String(s.excludedByScenario)} />
          <KV k="Sem equipamentos médicos" v={<Money value={s.estimateTotalExclMedicalEquipment} />} />
          <KV k="Equipamentos médicos" v={`${s.medicalEquipmentItems} pacotes · cenário à parte`} />
          <KV k="Custo/m² sobre o conhecido" v={s.coverage < 0.5 ? <span className="muted">Não significativo (cobertura {formatPct(s.coverage)})</span> : `${formatBRL(s.knownCostPerM2)}/m²`} />
        </div>
        {isAdmin && <ScenarioPicker value={scenario} onChange={setScenario} />}
      </Section>

      <Section title="Macroetapas com valor" action={<a className="link" href="#custos">Todas <ChevronRight size={16} aria-hidden /></a>}>
        {withValue.length === 0 ? (
          <div className="card pad muted">Nenhuma macroetapa tem valor ainda.</div>
        ) : (
          <div className="card list">
            {withValue.slice(0, 5).map((c) => (
              <Row key={c.code} href={`custos-${c.code}`}>
                <div className="between">
                  <span className="t">
                    <span className="code">{c.code}</span>
                    {c.name}
                  </span>
                  <Money value={c.subtotal} className="strong" />
                </div>
                <Bar value={c.subtotal} max={max} />
                <div className="meta">
                  {c.pricedCount} de {c.inScopeCount} pacotes com valor · {formatPct(c.pctOfKnown)} do conhecido
                </div>
              </Row>
            ))}
          </div>
        )}
        <p className="note">
          {cats.length - withValue.length} de {cats.length} macroetapas ainda sem nenhum valor.
        </p>
      </Section>
      <Section title="Atenção">
        <Banner>
          O subtotal de pesquisa da V2{research?.value ? ` (≈ ${formatBRLCompact(research.value)}, com BDI e contingência de sensibilidade)` : ''} é <strong>parcial</strong> e não está distribuído pelos pacotes. Não representa o custo do hospital. Veja{' '}
          <a className="link inline" href="#cenarios">
            Cenários e referências
          </a>
          .
        </Banner>
      </Section>
    </>
  )
}
function Layer({ letter, title, detail, value, href }: { letter: string; title: string; detail: string; value: React.ReactNode; href?: string }) {
  const body = (
    <div className="layer">
      <span className="letter">{letter}</span>
      <div className="grow">
        <div className="between">
          <span className="t">{title}</span>
          <span className="strong">{value}</span>
        </div>
        <div className="meta">{detail}</div>
      </div>
      {href && <ChevronRight size={18} className="chev" aria-hidden />}
    </div>
  )
  return href ? (
    <a className="row flush" href={`#${href}`}>
      {body}
    </a>
  ) : (
    body
  )
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="kvrow">
      <span className="muted">{k}</span>
      <span className="v">{v}</span>
    </div>
  )
}
function ScenarioPicker({ value, onChange }: { value: StructuralScenario | null; onChange: (v: StructuralScenario | null) => void }) {
  const { ds } = useCtx()
  return (
    <div className="card pad mt-s">
      <label htmlFor="scenario" className="flabel">
        Cenário estrutural ativo (mutuamente excludente)
      </label>
      <select id="scenario" className="field" value={value ?? 'nenhum'} onChange={(e) => onChange(e.target.value === 'nenhum' ? null : (e.target.value as StructuralScenario))}>
        <option value="nenhum">Nenhum (alternativas fora dos totais)</option>
        {ds.scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.comparability ? ` — ${s.comparability}` : ''}
          </option>
        ))}
      </select>
      <p className="note">Na versão de teste a escolha vale só neste navegador.</p>
    </div>
  )
}

function Costs() {
  const { cats, summary: s, units } = useCtx()
  const [sort, setSort] = useState<'etapa' | 'valor'>('etapa')
  const [filter, setFilter] = useState<'todas' | 'com' | 'sem'>('todas')
  let list = [...cats]
  if (filter === 'com') list = list.filter((c) => c.subtotal !== null)
  if (filter === 'sem') list = list.filter((c) => c.unpricedCount > 0)
  list.sort(sort === 'valor' ? (a, b) => (b.subtotal ?? -1) - (a.subtotal ?? -1) || a.sortOrder - b.sortOrder : (a, b) => a.sortOrder - b.sortOrder)
  const max = Math.max(0, ...cats.map((c) => c.subtotal ?? 0)) || null
  const multi = units.filter((u) => u.category === 'MULTI' && u.estimate !== null)
  return (
    <>
      <Header title="Custos" subtitle={`${cats.length} macroetapas · ${s.inScopeItems} pacotes no escopo`} />
      <div className="card pad sticky-total">
        <div className="between">
          <span className="label">Total conhecido</span>
          <Money value={s.estimateTotal} className="big" />
        </div>
        <Coverage done={s.coveredItems} total={s.inScopeItems} />
        <div className="meta">
          Cobertura {formatPct(s.coverage)} · {s.unpricedItems} pacotes sem preço
        </div>
      </div>
      <div className="stack">
        <Segmented label="Ordenação" value={sort} onChange={setSort} options={[['etapa', 'Por etapa'], ['valor', 'Por valor']]} />
        <Chips
          label="Filtro"
          value={filter}
          onChange={setFilter}
          options={[
            ['todas', 'Todas', cats.length],
            ['com', 'Com valor', cats.filter((c) => c.subtotal !== null).length],
            ['sem', 'Com pendência de preço', cats.filter((c) => c.unpricedCount > 0).length],
          ]}
        />
      </div>
      {list.length === 0 ? (
        <Empty title="Nenhuma macroetapa neste filtro." />
      ) : (
        <div className="card list mt">
          {list.map((c) => (
            <Row key={c.code} href={`custos-${c.code}`}>
              <div className="between">
                <span className="t">
                  <span className="code">{c.code}</span>
                  {c.name}
                </span>
                <Money value={c.subtotal} className="strong nowrap" />
              </div>
              <Bar value={c.subtotal} max={max} />
              <div className="meta wrap">
                <span>{c.itemCount} itens</span>
                <span>{c.unpricedCount} sem valor</span>
                {c.inScopeCount !== c.itemCount && <span>{c.itemCount - c.inScopeCount} alternativa(s) fora do cenário</span>}
                <span>{c.pctOfKnown === null ? '— do conhecido' : `${formatPct(c.pctOfKnown)} do conhecido`}</span>
              </div>
            </Row>
          ))}
        </div>
      )}
      {multi.length > 0 && <p className="note">{multi.length} proposta(s) global(is) cobrem mais de uma macroetapa e aparecem separadas, sem rateio.</p>}
    </>
  )
}

function Category({ code }: { code: string }) {
  const { ds, cats, unitByItem, opts } = useCtx()
  const [filter, setFilter] = useState<'todos' | 'com' | 'sem'>('todos')
  const cat = cats.find((c) => c.code === code)
  if (!cat) return <NotFound />
  const all = ds.items.filter((i) => i.group === code)
  const hasValue = (c: string) => unitByItem.get(c)?.estimate != null
  const noValue = (i: (typeof all)[number]) => isInScope(i, opts.activeScenario) && !hasValue(i.code)
  const items = all.filter((i) => (filter === 'com' ? hasValue(i.code) : filter === 'sem' ? noValue(i) : true))
  return (
    <>
      <Header title={cat.name} subtitle={`Macroetapa ${cat.code} · ${cat.itemCount} itens`} backTo="custos" backLabel="Custos" />
      <div className="card pad">
        <div className="between">
          <span className="label">Subtotal conhecido</span>
          <Money value={cat.subtotal} className="big" />
        </div>
        <Coverage done={cat.pricedCount} total={cat.inScopeCount} />
        <div className="meta">
          {cat.unpricedCount} sem valor · {cat.pctOfKnown === null ? 'sem participação no conhecido' : `${formatPct(cat.pctOfKnown)} do total conhecido`}
        </div>
      </div>
      <div className="mt">
        <Chips label="Filtro de itens" value={filter} onChange={setFilter} options={[['todos', 'Todos', all.length], ['com', 'Com valor', all.filter((i) => hasValue(i.code)).length], ['sem', 'Sem valor', all.filter(noValue).length]]} />
      </div>
      {items.length === 0 ? (
        <Empty title="Nenhum item neste filtro." />
      ) : (
        <div className="card list mt">
          {items.map((i) => {
            const u = unitByItem.get(i.code)
            const inScope = isInScope(i, opts.activeScenario)
            const grouped = u && u.itemCodes.length > 1
            return (
              <Row key={i.code} href={itemHash(i.code)}>
                <div className="between top">
                  <span className="t">
                    <span className="code">{i.code}</span>
                    {i.description}
                  </span>
                  <span className="strong nowrap">{!inScope ? <span className="muted">Fora do cenário</span> : grouped ? <span className="muted">Em grupo</span> : <Money value={u?.estimate ?? null} />}</span>
                </div>
                <div className="badges">
                  {u?.estimateSource && <Badge tone="accent">{ESTIMATE_SOURCE_LABEL[u.estimateSource]}</Badge>}
                  {grouped && <Badge>Proposta global · {u!.itemCodes.length} pacotes (sem rateio)</Badge>}
                  {i.scenario !== 'base' && <Badge tone={inScope ? 'neutral' : 'gap'}>{SCENARIO_LABEL[i.scenario]}</Badge>}
                  {i.costKind === 'equipamento_medico' && <Badge>Equipamento médico</Badge>}
                  {i.costKind === 'contingencia' && <Badge>Contingência</Badge>}
                  {i.status !== 'Não iniciado' && <Badge tone="warn">{i.status}</Badge>}
                </div>
              </Row>
            )
          })}
        </div>
      )}
    </>
  )
}

function ItemPage({ code }: { code: string }) {
  const { ds, unitByItem, opts, isAdmin, quoteHash } = useCtx()
  const item = ds.items.find((i) => i.code === code)
  if (!item) return <NotFound />
  const unit = unitByItem.get(item.code)
  const inScope = isInScope(item, opts.activeScenario)
  const ref = referenceTotal(item)
  const quotes = ds.quotes.filter((q) => q.itemCodes.includes(item.code) || q.packageRaw === item.code)
  const contracts = ds.contracts.filter((c) => c.itemCodes.includes(item.code))
  const grouped = unit && unit.itemCodes.length > 1
  const cat = ds.categories.find((c) => c.code === item.group)
  return (
    <>
      <Header title={item.description} subtitle={`${item.code} · ${cat?.name ?? ''}`} backTo={`custos-${item.group}`} backLabel={cat?.name ?? 'Macroetapa'} />
      {!inScope && (
        <div className="mb">
          <Banner tone="gap" title="Fora do cenário ativo">
            Este pacote pertence a “{SCENARIO_LABEL[item.scenario]}”. Alternativas estruturais são excludentes e só entram nos totais quando o cenário está ativo.
          </Banner>
        </div>
      )}
      <div className="card pad">
        <div className="label">Estimativa atual</div>
        {grouped ? (
          <>
            <div className="h3">Incluído em proposta global de {unit!.itemCodes.length} pacotes</div>
            <div className="meta">
              Valor do grupo: <Money value={unit!.estimate} className="strong" /> — sem rateio por pacote.
            </div>
            <div className="badges">
              {unit!.itemCodes.map((c) => (
                <a key={c} className="pill" href={`#${itemHash(c)}`}>
                  {c}
                </a>
              ))}
            </div>
          </>
        ) : (
          <div className="big mt-xs">
            <Money value={unit?.estimate ?? null} />
          </div>
        )}
        <div className="meta">{unit?.estimateSource ? `Fonte: ${ESTIMATE_SOURCE_LABEL[unit.estimateSource]}${unit.estimateSource === 'proposta' ? ' — proposta não é contrato.' : ''}` : 'Sem orçamento de referência, proposta comparável ou contrato.'}</div>
      </div>
      <Section title="Orçamento de referência (camada A)">
        <Facts
          rows={[
            ['Unidade', item.unit],
            ['Quantidade', item.quantity === null ? <span className="missing">Não informada</span> : `${formatNumber(item.quantity)} (estimada)`],
            ['Preço unitário', <Money key="u" value={item.unitPrice} />],
            ['Total de referência', <Money key="t" value={ref} />],
            ['Tipo de preço', item.priceType ? PRICE_TYPE_LABEL[item.priceType] : null],
            ['Data-base', item.priceDate ? formatDate(item.priceDate) : null],
            ['Fonte', item.source],
            ['Confiabilidade', item.confidence ? CONFIDENCE_LABEL[item.confidence] : null],
            ['Situação', item.status],
            ['Cenário', `${SCENARIO_LABEL[item.scenario]}${item.scenarioInferred ? ' (inferido — revisar)' : ''}`],
            ['Tipo de custo', item.costKind === 'equipamento_medico' ? 'Equipamento médico (cenário à parte)' : item.costKind === 'contingencia' ? 'Contingência / reserva' : 'Custo direto'],
          ]}
        />
      </Section>
      {isAdmin ? (
        <Section title={`Propostas (${quotes.length})`}>
          {quotes.length === 0 ? (
            <div className="card pad muted">Nenhuma proposta registrada para este pacote.</div>
          ) : (
            <div className="card list">
              {quotes.map((q) => {
                const reason = quoteExclusionReason(q)
                return (
                  <Row key={q.id} href={quoteHash(q)}>
                    <div className="between top">
                      <span className="t">{q.supplier ?? 'Fornecedor não informado'}</span>
                      <span className="strong nowrap">{quoteAmountLabel(q)}</span>
                    </div>
                    <div className="meta">{q.service}</div>
                    <div className="badges">
                      <Badge>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                      {q.isInternal && <Badge tone="accent">Interna ARTO · cliente não vê</Badge>}
                      {q.isVerbal && <Badge tone="warn">Informado verbalmente</Badge>}
                      {unit?.chosenQuote?.id === q.id && <Badge tone="accent">Usada na estimativa</Badge>}
                      {reason && <Badge tone="gap">{reason}</Badge>}
                    </div>
                  </Row>
                )
              })}
            </div>
          )}
        </Section>
      ) : (
        quotes.length > 0 && (
          <Section title="Propostas">
            <div className="card pad muted">{quotes.length} proposta(s) em análise pela equipe ARTO.</div>
          </Section>
        )
      )}
      <Section title="Contrato e medições (camada C)">
        {contracts.length === 0 ? (
          <div className="card pad muted">Nenhum contrato registrado.</div>
        ) : (
          <div className="card list">
            {contracts.map((c) => (
              <div key={c.id} className="kvrow">
                <span>{c.id}</span>
                <Money value={contractUpdatedAmount(c)} className="strong" />
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Origem">
        <div className="card pad meta">
          Planilha V4 · aba <strong>Orçamento detalhado</strong> · linha <strong>{item.sheetRow}</strong>
          {item.notes && <p>{item.notes}</p>}
        </div>
      </Section>
    </>
  )
}

function Abc() {
  const { units, ds, summary: s } = useCtx()
  const [base, setBase] = useState<AbcBase>('estimativa')
  const [mode, setMode] = useState<AbcMode>('itens')
  const r = abcFromUnits(units, ds.categories, mode, base)
  const priced = base === 'estimativa' ? s.coveredItems : s.referencePricedItems
  const coverage = s.inScopeItems ? priced / s.inScopeItems : 0
  const link = (key: string) => (mode === 'categorias' ? (key === 'MULTI' ? 'custos' : `custos-${key}`) : itemHash(key.startsWith('GRUPO:') ? key.slice(6).split('+')[0] : key))
  const top = r.rows.slice(0, 15)
  const max = top[0]?.value ?? 1
  const counts = { A: r.rows.filter((x) => x.cls === 'A').length, B: r.rows.filter((x) => x.cls === 'B').length, C: r.rows.filter((x) => x.cls === 'C').length }
  return (
    <>
      <Header title="Curva ABC" subtitle="Ranking dos custos conhecidos e concentração acumulada" />
      <div className="stack">
        <Segmented label="Base" value={base} onChange={setBase} options={[['estimativa', 'Estimativa atual'], ['referencia', 'Orçamento-base']]} />
        <Segmented label="Agrupamento" value={mode} onChange={setMode} options={[['itens', 'Itens'], ['categorias', 'Macroetapas']]} />
      </div>
      <div className="mt">
        <Banner tone={coverage < 0.8 ? 'warn' : 'neutral'} title={coverage < 1 ? 'ABC PARCIAL — não representa o hospital completo' : undefined}>
          Denominador: <strong>{r.total === null ? 'sem valores' : formatBRL(r.total)}</strong> em {r.pricedEntries} {mode === 'itens' ? 'entrada(s)' : 'macroetapa(s)'} com valor. Cobertura: {priced} de {s.inScopeItems} pacotes ({formatPct(coverage)}).
        </Banner>
      </div>
      {r.rows.length === 0 ? (
        <div className="mt">
          <Empty title="Sem valores para esta base">
            {base === 'referencia' ? `Nenhum pacote tem quantidade × preço de referência (${s.referencePricedItems} de ${s.inScopeItems}).` : 'Nenhum pacote tem valor conhecido ainda.'}
          </Empty>
          <button type="button" className="btn secondary full mt-s" onClick={() => setBase('estimativa')}>
            Ver estimativa atual
          </button>
        </div>
      ) : (
        <>
          <Section title={r.rows.length > 15 ? 'Top 15' : 'Gráfico'}>
            <div className="card pad chart" role="img" aria-label={`Barras horizontais de ${top.length} entradas; valores completos no ranking abaixo.`}>
              {top.map((row) => (
                <div key={row.key} className="hbar" title={`${row.label}: ${formatBRL(row.value)} · ${formatPct(row.pct)} · acumulado ${formatPct(row.cumPct)}`}>
                  <span className="hlabel">
                    {row.rank}. {row.label}
                  </span>
                  <div className="htrack">
                    <div className={`hfill c${row.cls}`} style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
                  </div>
                </div>
              ))}
              <ul className="legend">
                {(['A', 'B', 'C'] as const).map((c) => (
                  <li key={c}>
                    <span className={`sw c${c}`} />
                    Classe {c} ({counts[c]}) · {c === 'A' ? 'até 80%' : c === 'B' ? '80–95%' : 'acima de 95%'}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
          <Section title="Ranking">
            <div className="card list">
              {r.rows.map((row) => (
                <Row key={row.key} href={link(row.key)}>
                  <div className="rank">
                    <span className="num muted">{row.rank}</span>
                    <span className="grow">
                      <span className="t block">{row.label}</span>
                      <span className="meta num">
                        {formatPct(row.pct)} individual · {formatPct(row.cumPct)} acumulado
                      </span>
                    </span>
                    <span className="right">
                      <Money value={row.value} className="strong block" />
                      <span className={`cls c${row.cls}`}>{row.cls}</span>
                    </span>
                  </div>
                </Row>
              ))}
            </div>
          </Section>
        </>
      )}
      <Section title="Notas metodológicas">
        <ul className="card pad bullets">
          <li>Estimativa atual: por pacote, contrato › proposta de referência › orçamento-base.</li>
          <li>Propostas globais de vários pacotes entram como uma linha única, sem rateio.</li>
          <li>Pacotes sem valor ficam fora do ranking (não viram R$ 0) e reduzem a cobertura.</li>
          <li>Tarifas, valores mensais, opcionais, propostas internas e vínculos divergentes não entram.</li>
          <li>Classe A até 80% do acumulado (o item que cruza 80% é A); B até 95%; C o restante.</li>
        </ul>
      </Section>
    </>
  )
}

function Quotes() {
  const { ds, quoteHash } = useCtx()
  const [status, setStatus] = useState<'todas' | QuoteStatus>('todas')
  const list = status === 'todas' ? ds.quotes : ds.quotes.filter((q) => q.status === status)
  return (
    <>
      <Header title="Propostas" subtitle={`${ds.quotes.length} registradas · ${ds.quotes.filter(isQuoteComparable).length} com valor global comparável · ${ds.quotes.filter((q) => q.isInternal).length} internas ARTO`} />
      <Banner>Propostas não se somam entre si nem ao orçamento. Propostas internas ARTO (gerenciamento de obra) servem de base de escopo e não aparecem para o cliente.</Banner>
      <div className="mt">
        <Chips
          label="Status"
          value={status}
          onChange={setStatus}
          options={[['todas', 'Todas', ds.quotes.length] as ['todas', string, number], ...QUOTE_STATUS_ORDER.filter((s) => ds.quotes.some((q) => q.status === s)).map((s) => [s, QUOTE_STATUS_LABEL[s], ds.quotes.filter((q) => q.status === s).length] as [QuoteStatus, string, number])]}
        />
      </div>
      <div className="card list mt">
        {list.map((q) => {
          const reason = quoteExclusionReason(q)
          return (
            <Row key={q.id} href={quoteHash(q)}>
              <div className="between top">
                <span className="t strong">{q.supplier ?? 'Fornecedor não informado'}</span>
                <span className="strong nowrap">{quoteAmountLabel(q)}</span>
              </div>
              <div className="meta">{q.service}</div>
              <div className="meta">
                {q.packageRaw ?? 'sem pacote'}
                {q.itemCodes.length > 1 ? ` → ${q.itemCodes.join(', ')}` : ''} · {q.receivedAt ? formatDate(q.receivedAt) : 'sem data'}
              </div>
              <div className="badges">
                <Badge>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                {q.isInternal && <Badge tone="accent">Interna ARTO · cliente não vê</Badge>}
                {q.isVerbal && <Badge tone="warn">Informado verbalmente</Badge>}
                {q.linkStatus === 'inferido' && <Badge>Vínculo inferido</Badge>}
                {reason && <Badge tone="gap">{reason}</Badge>}
              </div>
            </Row>
          )
        })}
      </div>
    </>
  )
}

function QuotePage({ idx }: { idx: number }) {
  const { ds, unitByItem, quoteHash } = useCtx()
  const q = ds.quotes[idx]
  if (!q) return <NotFound />
  const reason = quoteExclusionReason(q)
  const items = ds.items.filter((i) => q.itemCodes.includes(i.code))
  const competitors = ds.quotes.filter((o) => o.id !== q.id && o.itemCodes.some((c) => q.itemCodes.includes(c)))
  const unit = q.itemCodes[0] ? unitByItem.get(q.itemCodes[0]) : undefined
  return (
    <>
      <Header title={q.supplier ?? 'Fornecedor não informado'} subtitle={`${q.service} · ${q.id}`} backTo="propostas" backLabel="Propostas" />
      <div className="card pad">
        <div className="label">{AMOUNT_KIND_LABEL[q.amountKind]}</div>
        <div className="big mt-xs">{quoteAmountLabel(q)}</div>
        <div className="badges">
          <Badge>{QUOTE_STATUS_LABEL[q.status]}</Badge>
          {q.statusRaw && <Badge>Planilha: {q.statusRaw}</Badge>}
          {q.isInternal && <Badge tone="accent">Interna ARTO · cliente não vê</Badge>}
          {q.isVerbal && <Badge tone="warn">Informado verbalmente</Badge>}
          {unit?.chosenQuote?.id === q.id && <Badge tone="accent">Usada na estimativa</Badge>}
        </div>
        {reason && (
          <div className="mt-s">
            <Banner tone="gap" title="Não entra em totais">
              {reason}.
            </Banner>
          </div>
        )}
      </div>
      {q.linkNote && (
        <div className="mt-s">
          <Banner tone={q.linkStatus === 'divergente' || q.linkStatus === 'sem_item' ? 'warn' : 'neutral'} title={q.linkStatus === 'inferido' ? 'Vínculo inferido' : q.linkStatus === 'divergente' ? 'Vínculo divergente' : 'Vínculo'}>
            {q.linkNote}
          </Banner>
        </div>
      )}
      <Section title="Pacotes">
        {items.length === 0 ? (
          <div className="card pad muted">Sem pacote associado.</div>
        ) : (
          <div className="card list">
            {items.map((i) => (
              <Row key={i.code} href={itemHash(i.code)}>
                <span className="t">
                  <span className="code">{i.code}</span>
                  {i.description}
                </span>
              </Row>
            ))}
          </div>
        )}
      </Section>
      <Section title="Escopo e condições">
        <Facts
          rows={[
            ['Escopo e exclusões', q.scope],
            ['Recebida em', q.receivedAt ? formatDate(q.receivedAt) : null],
            ['Prazo de execução', q.durationDays !== null ? `${q.durationDays} dias` : null],
            ['Inclui impostos?', q.includesTaxes],
            ['Documento', q.documentRef],
            ['Próxima ação', q.nextAction],
            ['Origem', q.sheetRow ? `Propostas fornecedores, linha ${q.sheetRow}` : null],
          ]}
        />
      </Section>
      <Section title={`Concorrentes no mesmo pacote (${competitors.length})`}>
        {competitors.length === 0 ? (
          <div className="card pad muted">Nenhuma outra proposta registrada para estes pacotes.</div>
        ) : (
          <div className="card list">
            {competitors.map((o) => (
              <Row key={o.id} href={quoteHash(o)}>
                <div className="between top">
                  <span className="t">{o.supplier}</span>
                  <span className="strong nowrap">{quoteAmountLabel(o)}</span>
                </div>
                <div className="meta">{o.service}</div>
              </Row>
            ))}
          </div>
        )}
        <p className="note">Concorrentes não são cumulativos: a estimativa usa a de referência ou a de menor valor global comparável.</p>
      </Section>
    </>
  )
}

function SearchPage() {
  const { ds, isAdmin, unitByItem, quoteHash } = useCtx()
  const [q, setQ] = useState(() => store.get('arto_busca') ?? '')
  useEffect(() => store.set('arto_busca', q), [q])
  const terms = norm(q).split(' ').filter(Boolean)
  const match = (...f: Array<string | null | undefined>) => {
    const h = norm(f.filter(Boolean).join(' '))
    return terms.length > 0 && terms.every((t) => h.includes(t))
  }
  const cats = ds.categories.filter((c) => match(c.code, c.name))
  const items = ds.items.filter((i) => match(i.code, i.description, i.categoryName, i.source, i.notes))
  const quotes = isAdmin ? ds.quotes.filter((x) => match(x.id, x.supplier, x.service, x.packageRaw, x.scope, x.itemCodes.join(' '))) : []
  const total = cats.length + items.length + quotes.length
  return (
    <>
      <Header title="Busca" subtitle={isAdmin ? 'Código, serviço, disciplina ou fornecedor' : 'Código, serviço ou disciplina'} backTo="mais" backLabel="Mais" />
      <form className="searchbar" role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="busca" className="sr">
          Termo de busca
        </label>
        <input id="busca" type="search" className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex.: 12.006, HVAC, gases" enterKeyHint="search" />
        <Search size={18} className="searchicon" aria-hidden />
      </form>
      {!q.trim() ? (
        <p className="note center">Digite ao menos um termo. Acentos e maiúsculas são ignorados.</p>
      ) : total === 0 ? (
        <Empty title={`Nada encontrado para “${q}”`}>Tente o código (ex.: 06.004), parte do nome ou a disciplina.</Empty>
      ) : (
        <>
          <p className="note">{total} resultado(s)</p>
          {cats.length > 0 && (
            <Section title="Macroetapas">
              <div className="card list">
                {cats.map((c) => (
                  <Row key={c.code} href={`custos-${c.code}`}>
                    <span className="t">
                      <span className="code">{c.code}</span>
                      {c.name}
                    </span>
                  </Row>
                ))}
              </div>
            </Section>
          )}
          {items.length > 0 && (
            <Section title={`Pacotes (${items.length})`}>
              <div className="card list">
                {items.slice(0, 60).map((i) => {
                  const u = unitByItem.get(i.code)
                  return (
                    <Row key={i.code} href={itemHash(i.code)}>
                      <div className="between top">
                        <span className="t">
                          <span className="code">{i.code}</span>
                          {i.description}
                        </span>
                        <span className="strong nowrap">{u && u.itemCodes.length > 1 ? <span className="muted">Em grupo</span> : <Money value={u?.estimate ?? null} />}</span>
                      </div>
                      <div className="meta">{i.categoryName}</div>
                    </Row>
                  )
                })}
              </div>
            </Section>
          )}
          {quotes.length > 0 && (
            <Section title={`Propostas (${quotes.length})`}>
              <div className="card list">
                {quotes.map((x) => (
                  <Row key={x.id} href={quoteHash(x)}>
                    <div className="between top">
                      <span className="t">{x.supplier}</span>
                      <span className="strong nowrap">{quoteAmountLabel(x)}</span>
                    </div>
                    <div className="meta">{x.service}</div>
                  </Row>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </>
  )
}

const TIER_ORDER = { alto: 0, medio: 1, baixo: 2 } as const
const TIER_LABEL = { alto: 'Risco alto', medio: 'Risco médio', baixo: 'Risco baixo' } as const
const TIER_TONE = { alto: 'danger', medio: 'warn', baixo: 'neutral' } as const

function Pendencias() {
  const { ds, unitByItem, opts, isAdmin } = useCtx()
  const [tab, setTab] = useState<'criticas' | 'sem'>('criticas')
  const [risk, setRisk] = useState<'todos' | 'alto' | 'medio' | 'baixo'>('todos')
  const [limit, setLimit] = useState(40)
  const unpricedIn = (groups: string[]) => ds.items.filter((i) => groups.includes(i.group) && isInScope(i, opts.activeScenario) && unitByItem.get(i.code)?.estimate == null).length
  const pend = ds.pendencias
    .map((p) => ({ ...p, tier: pendenciaRiskTier(p.title, p.statusRaw), unpriced: unpricedIn(p.groups) }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.unpriced - a.unpriced || a.sheetRow - b.sheetRow)
  const quoted = new Set(ds.quotes.flatMap((q) => q.itemCodes))
  const noQuote = ds.items
    .filter((i) => isInScope(i, opts.activeScenario) && !quoted.has(i.code) && unitByItem.get(i.code)?.estimate == null)
    .map((i) => ({ ...i, tier: CATEGORY_RISK[i.group] ?? 'medio' }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.code.localeCompare(b.code))
  const filtered = risk === 'todos' ? noQuote : noQuote.filter((i) => i.tier === risk)
  return (
    <>
      <Header title="Pendências" subtitle="Ordenadas por risco e impacto" backTo={isAdmin ? 'mais' : undefined} backLabel="Mais" />
      <Chips label="Abas" value={tab} onChange={setTab} options={[['criticas', 'Críticas', pend.length], ['sem', 'Pacotes sem cotação', noQuote.length]]} />
      {tab === 'criticas' ? (
        <>
          <p className="note">Risco = heurística do app (sistemas críticos e estrutura = alto), desempate pelo nº de pacotes sem preço nas macroetapas relacionadas.</p>
          <div className="card list">
            {pend.map((p) => (
              <div key={p.id} className="block-row">
                <div className="between top">
                  <span className="t strong">{p.title}</span>
                  <Badge tone={TIER_TONE[p.tier]}>{TIER_LABEL[p.tier]}</Badge>
                </div>
                <div className="body">{p.info}</div>
                <div className="badges">
                  <Badge tone="gap">{p.statusRaw}</Badge>
                  {p.document && <span className="meta">Base: {p.document}</span>}
                </div>
                {p.groups.length > 0 && (
                  <div className="badges">
                    {p.groups.map((g) => (
                      <a key={g} className="pill" href={`#custos-${g}`}>
                        {g} · {ds.categories.find((c) => c.code === g)?.name} ({unpricedIn([g])} sem preço)
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mt">
            <Chips
              label="Risco"
              value={risk}
              onChange={(v) => {
                setRisk(v)
                setLimit(40)
              }}
              options={[['todos', 'Todos', noQuote.length], ...(['alto', 'medio', 'baixo'] as const).map((t) => [t, TIER_LABEL[t], noQuote.filter((i) => i.tier === t).length] as [typeof t, string, number])]}
            />
          </div>
          <div className="card list mt-s">
            {filtered.slice(0, limit).map((i) => (
              <Row key={i.code} href={itemHash(i.code)}>
                <div className="between top">
                  <span>
                    <span className="t block">
                      <span className="code">{i.code}</span>
                      {i.description}
                    </span>
                    <span className="meta">{i.categoryName}</span>
                  </span>
                  <Badge tone={TIER_TONE[i.tier]}>{TIER_LABEL[i.tier]}</Badge>
                </div>
              </Row>
            ))}
          </div>
          {filtered.length > limit && (
            <button type="button" className="btn secondary full mt-s" onClick={() => setLimit(limit + 60)}>
              Mostrar mais ({filtered.length - limit} restantes)
            </button>
          )}
        </>
      )}
    </>
  )
}

function Scenarios() {
  const { ds, isAdmin, scenario, setScenario } = useCtx()
  const bdi = ds.references.find((r) => /bdi de sensibilidade/.test(norm(r.label)))?.value ?? null
  const research = ds.references.filter((r) => r.sheet === 'Pesquisa aprofundada V2')
  const physical = ds.references.filter((r) => r.sheet === 'V4 Base fisica e limites')
  const fmtRef = (value: number | null, unit: string | null, text: string | null) => {
    if (value === null) return text ?? '—'
    const u = norm(unit)
    if (u === 'r$') return formatBRL(value)
    if (u === 'fracao') return formatPct(value)
    if (u.startsWith('r$/')) return `${formatBRL(value)}/${unit?.replace(/^R\$\//, '')}`
    return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
  }
  return (
    <>
      <Header title="Cenários e referências" subtitle="Valores paramétricos e de pesquisa — não são orçamento" backTo="mais" backLabel="Mais" />
      <Section title="Alternativas estruturais (excludentes)">
        <Banner tone="warn" title="Nunca somar alternativas">
          Concreto, metálica e LSF são cenários mutuamente excludentes. Apenas um pode estar ativo.
        </Banner>
        <div className="stack mt-s">
          {ds.scenarios.map((s) => (
            <div key={s.id} className="card pad">
              <div className="between top">
                <span className="h3">{s.name}</span>
                {scenario === s.id ? <Badge tone="accent">Ativo</Badge> : <Badge tone="gap">Inativo</Badge>}
              </div>
              <div className="kvrow">
                <span className="muted">Custo direto paramétrico</span>
                <Money value={s.directCost} className="strong" />
              </div>
              <div className="kvrow">
                <span className="muted">Com BDI de sensibilidade{bdi !== null ? ` (${formatPct(bdi)})` : ''}</span>
                <Money value={s.directCost !== null && bdi !== null ? s.directCost * (1 + bdi) : null} empty="—" />
              </div>
              <div className="kvrow">
                <span className="muted">Comparabilidade</span>
                <span>{s.comparability}</span>
              </div>
              <p className="meta">{s.notes}</p>
              <p className="meta">Valor agregado: não é atribuído a pacotes nem entra no custo conhecido.</p>
            </div>
          ))}
        </div>
        {isAdmin && <ScenarioPicker value={scenario} onChange={setScenario} />}
      </Section>
      <Section title="Pesquisa aprofundada V2 (parcial)">
        <div className="card list">
          {research.map((r) => (
            <div key={r.id} className="block-row">
              <div className="between top">
                <span className="t">{r.label}</span>
                <span className="strong nowrap">{fmtRef(r.value, r.unit, r.valueText)}</span>
              </div>
              <div className="meta">
                {r.notes} · linha {r.sheetRow}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Base física (memorial)">
        <div className="card list">
          {physical.map((r) => (
            <div key={r.id} className="kvrow">
              <span>
                <span className="block">{r.label}</span>
                <span className="meta">{r.notes}</span>
              </span>
              <span className="strong nowrap">{fmtRef(r.value, r.unit, r.valueText)}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

function Schedule() {
  const { ds } = useCtx()
  const phases = [...new Set(ds.milestones.map((m) => m.phase))]
  return (
    <>
      <Header title="Cronograma de marcos" subtitle={`${ds.milestones.length} marcos em ${phases.length} fases`} backTo="mais" backLabel="Mais" />
      {ds.milestones.every((m) => !m.plannedStart) && <Banner>Nenhuma data lançada na planilha — o app não inventa datas.</Banner>}
      {phases.map((ph) => (
        <Section key={ph} title={ph}>
          <div className="card list">
            {ds.milestones
              .filter((m) => m.phase === ph)
              .map((m) => (
                <div key={m.id} className="kvrow">
                  <span>
                    <span className="block">{m.title}</span>
                    <span className="meta">
                      {m.id} · {m.plannedStart ? `${formatDate(m.plannedStart)} – ${formatDate(m.plannedEnd)}` : 'Sem data'}
                    </span>
                  </span>
                  <Badge tone="gap">{m.status ?? '—'}</Badge>
                </div>
              ))}
          </div>
        </Section>
      ))}
    </>
  )
}

function Tracking() {
  const { units, ds } = useCtx()
  const t = tracking(units)
  return (
    <>
      <Header title="Estimado × contratado × realizado" subtitle="Por pacote ou grupo, sem duplicar valores" backTo="mais" backLabel="Mais" />
      <div className="grid2">
        <Kpi label="Estimado" value={<Money value={t.totals.estimated} empty="—" />} />
        <Kpi label="Contratado" value={<Money value={t.totals.contracted} empty="—" />} />
        <Kpi label="Medido" value={<Money value={t.totals.measured} empty="—" />} />
        <Kpi label="Pago" value={<Money value={t.totals.paid} empty="—" />} />
      </div>
      <p className="note">Diferença contratado − estimado: {t.totals.comparablePairs ? formatBRL(t.totals.diff) : 'indisponível — nenhum pacote tem estimativa e contrato ao mesmo tempo'}.</p>
      <Section title="Por unidade de custo">
        <div className="card list">
          {t.rows.map((r) => (
            <Row key={r.unit.key} href={itemHash(r.unit.itemCodes[0])}>
              <span className="t block">{r.unit.label}</span>
              <div className="kvrow flat">
                <span className="muted">Estimado</span>
                <Money value={r.estimated} empty="—" />
              </div>
              <div className="kvrow flat">
                <span className="muted">Contratado</span>
                <Money value={r.contracted} empty="Sem contrato" />
              </div>
            </Row>
          ))}
        </div>
      </Section>
      {ds.contracts.length === 0 && <Banner>Nenhum contrato registrado. Na versão servidor, contratos são registrados a partir de uma proposta.</Banner>}
    </>
  )
}

function Report() {
  const { summary: s } = useCtx()
  const r = SNAP.report
  const list = (items: string[]) => (
    <div className="card list">
      {items.length ? items.map((t, i) => <div key={i} className="block-row meta">{t}</div>) : <div className="block-row muted">Nenhum.</div>}
    </div>
  )
  return (
    <>
      <Header title="Relatório de importação" subtitle={r ? `Importação de ${formatDateTime(r.at)}` : ''} backTo="mais" backLabel="Mais" />
      <Section title="Cobertura">
        <div className="card list">
          {[
            ['Pacotes totais', s.totalItems],
            ['No escopo do cenário', s.inScopeItems],
            ['Com orçamento de referência (A)', s.referencePricedItems],
            ['Com algum valor', `${s.coveredItems} (${formatPct(s.coverage)})`],
            ['Sem preço', s.unpricedItems],
            ['Propostas registradas', s.quoteCount],
            ['Propostas fora dos totais', s.quotesExcluded],
            ['Contratos', s.contractCount],
          ].map(([k, v]) => (
            <KV key={String(k)} k={String(k)} v={<span className="num strong">{v}</span>} />
          ))}
        </div>
      </Section>
      {r && (
        <>
          <Section title="Propostas sem pacote / vínculo divergente">{list(r.quotesWithoutItem.map((q) => `${q.id}: ${q.reason}`))}</Section>
          <Section title={`Alertas (${r.alerts.length})`}>{list(r.alerts)}</Section>
          <Section title={`Divergências (${r.divergences.length})`}>{list(r.divergences.map((d) => `${d.sheet ? `${d.sheet}${d.row ? ` L${d.row}` : ''}: ` : ''}${d.message}`))}</Section>
        </>
      )}
    </>
  )
}

function More() {
  const { isAdmin, ds, summary, role } = useCtx()
  const links = [
    ['busca', 'Busca global', 'Código, serviço, disciplina ou fornecedor', false],
    ['pendencias', 'Pendências críticas', `${ds.pendencias.length} pendências · ${summary.unpricedItems} pacotes sem preço`, false],
    ['acompanhamento', 'Estimado × contratado × realizado', summary.contractCount ? `${summary.contractCount} contrato(s)` : 'Nenhum contrato registrado', true],
    ['cenarios', 'Cenários e referências', 'Alternativas estruturais, pesquisa V2, base física', false],
    ['cronograma', 'Cronograma de marcos', `${ds.milestones.length} marcos`, false],
    ['relatorio', 'Relatório de importação e cobertura', 'Divergências, propostas não somadas, alertas', true],
  ].filter((l) => isAdmin || !l[3]) as Array<[string, string, string, boolean]>
  return (
    <>
      <Header title="Mais" subtitle={`Visualizando como ${role === 'admin' ? 'administrador' : 'cliente'}`} />
      <div className="card list">
        {links.map(([href, label, hint]) => (
          <Row key={href} href={href}>
            <div className="between">
              <span>
                <span className="t block">{label}</span>
                <span className="meta">{hint}</span>
              </span>
              <ChevronRight size={18} className="chev" aria-hidden />
            </div>
          </Row>
        ))}
      </div>
      <Section title="Sobre esta versão de teste">
        <div className="card pad meta">
          Cópia somente leitura dos dados importados da planilha {ds.project.sourceFile} em {formatDateTime(SNAP.generatedAt)}. Lançar preços, registrar contratos e medições, reimportar a planilha e o login com senha existem na versão servidor. Use o seletor no topo para alternar entre a visão de administrador e a do cliente.
        </div>
      </Section>
    </>
  )
}

function NotFound() {
  return (
    <Empty title="Registro não encontrado">
      <a className="link inline" href="#custos">
        Ver custos
      </a>
    </Empty>
  )
}

// ---------------------------------------------------------------- shell
const ADMIN_ONLY = /^(propostas|proposta-|acompanhamento|relatorio)/

function App() {
  const route = useRoute()
  const [role, setRoleState] = useState<Role>(() => (store.get('arto_role') === 'cliente' ? 'cliente' : 'admin'))
  const [scenario, setScenarioState] = useState<StructuralScenario | null>(() => {
    const s = store.get('arto_cenario')
    return s === 'concreto' || s === 'metalica' || s === 'lsf' ? s : SNAP.dataset.scenarios.find((x) => x.isActive)?.id ?? null
  })
  const setRole = (r: Role) => {
    setRoleState(r)
    store.set('arto_role', r)
  }
  const setScenario = (s: StructuralScenario | null) => {
    setScenarioState(s)
    store.set('arto_cenario', s ?? 'nenhum')
  }
  const ctx = useMemo<Ctx>(() => {
    const base = role === 'admin' ? SNAP.dataset : clientView(SNAP.dataset)
    const ds: Dataset = { ...base, scenarios: base.scenarios.map((s) => ({ ...s, isActive: s.id === scenario })) }
    const opts: CalcOptions = { activeScenario: scenario, includeMedicalEquipment: true }
    const units = buildCostUnits(ds, opts)
    const idx = new Map(ds.quotes.map((q, i) => [q.id, i]))
    return {
      ds,
      role,
      isAdmin: role === 'admin',
      opts,
      units,
      unitByItem: new Map(units.flatMap((u) => u.itemCodes.map((c) => [c, u] as const))),
      summary: summarize(ds, opts, units),
      cats: categorySummaries(ds, opts, units),
      scenario,
      setScenario,
      quoteHash: (q: Quote) => `proposta-${idx.get(q.id)}`,
    }
  }, [role, scenario])

  const blocked = !ctx.isAdmin && ADMIN_ONLY.test(route)
  let page: React.ReactNode
  if (blocked) page = <Empty title="Acesso restrito ao administrador">A visão do cliente não mostra propostas, fornecedores nem dados internos.</Empty>
  else if (!route || route === 'inicio') page = <Overview />
  else if (route === 'custos') page = <Costs />
  else if (/^custos-\d\d$/.test(route)) page = <Category code={route.slice(7)} />
  else if (/^item-\d\d-\d{3}$/.test(route)) page = <ItemPage code={codeFromHash(route)} />
  else if (route === 'abc') page = <Abc />
  else if (route === 'propostas') page = <Quotes />
  else if (/^proposta-\d+$/.test(route)) page = <QuotePage idx={Number(route.slice(9))} />
  else if (route === 'busca') page = <SearchPage />
  else if (route === 'pendencias') page = <Pendencias />
  else if (route === 'cenarios') page = <Scenarios />
  else if (route === 'cronograma') page = <Schedule />
  else if (route === 'acompanhamento') page = <Tracking />
  else if (route === 'relatorio') page = <Report />
  else if (route === 'mais') page = <More />
  else page = <NotFound />

  const tab = (r: string) =>
    r === ''
      ? route === '' || route === 'inicio'
      : r === 'custos'
        ? route.startsWith('custos') || route.startsWith('item-')
        : r === 'abc'
          ? route === 'abc'
          : r === 'propostas'
            ? route.startsWith('propost')
            : r === 'pendencias'
              ? route === 'pendencias'
              : !['', 'inicio', 'abc'].includes(route) && !route.startsWith('custos') && !route.startsWith('item-') && !route.startsWith('propost') && !(route === 'pendencias' && !ctx.isAdmin)
  const tabs: Array<[string, string, typeof Home]> = [
    ['', 'Visão geral', Home],
    ['custos', 'Custos', ListTree],
    ['abc', 'Curva ABC', BarChart3],
    ctx.isAdmin ? ['propostas', 'Propostas', FileText] : ['pendencias', 'Pendências', TriangleAlert],
    ['mais', 'Mais', MoreHorizontal],
  ]

  return (
    <C.Provider value={ctx}>
      <div className="topbar">
        <div className="inner">
          <span className="brand">
            ARTO <span>· Obras Hospitalares</span>
          </span>
          <div className="roleswitch" role="group" aria-label="Ver como">
            <button type="button" aria-pressed={role === 'admin'} className={cx(role === 'admin' && 'on')} onClick={() => setRole('admin')}>
              Admin
            </button>
            <button type="button" aria-pressed={role === 'cliente'} className={cx(role === 'cliente' && 'on')} onClick={() => setRole('cliente')}>
              Cliente
            </button>
          </div>
        </div>
      </div>
      <div className="testbar">Versão de teste · somente leitura · não compartilhe o link (contém dados internos)</div>
      <main className="main" key={route + role}>
        {page}
      </main>
      <nav className="bottomnav" aria-label="Navegação principal">
        <ul>
          {tabs.map(([r, label, Icon]) => {
            const active = tab(r)
            return (
              <li key={label}>
                <a href={`#${r || 'inicio'}`} aria-current={active ? 'page' : undefined} className={cx(active && 'on')}>
                  <Icon size={22} strokeWidth={active ? 2.3 : 1.8} aria-hidden />
                  {label}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
    </C.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
