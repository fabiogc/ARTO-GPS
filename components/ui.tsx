import Link from 'next/link'
import type { ReactNode } from 'react'
import { NOT_PRICED, formatBRL } from '@/lib/format'

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ')
}

export function PageHeader({ title, subtitle, back, right }: { title: string; subtitle?: ReactNode; back?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-4">
      {back}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <div className="mt-1 text-[14px] leading-snug text-muted">{subtitle}</div>}
        </div>
        {right}
      </div>
    </header>
  )
}

export function Section({ title, children, action, id }: { title?: string; children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <section className="mt-6" aria-labelledby={id}>
      {title && (
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <h2 id={id} className="text-[13px] font-semibold tracking-wide text-muted uppercase">
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Valor monetário; ausência aparece como “Não precificado”, nunca como R$ 0. */
export function Money({ value, empty = NOT_PRICED, className }: { value: number | null | undefined; empty?: string; className?: string }) {
  if (value === null || value === undefined) {
    return <span className={cx('font-medium text-gap italic', className)} data-missing="true">{empty}</span>
  }
  return <span className={cx('num', className)}>{formatBRL(value)}</span>
}

type Tone = 'neutral' | 'accent' | 'warn' | 'danger' | 'ok' | 'gap'
const TONES: Record<Tone, string> = {
  neutral: 'bg-[#efeeea] text-ink-2',
  accent: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  ok: 'bg-ok-soft text-ok',
  gap: 'bg-gap-soft text-muted',
}
export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[12px] leading-5 font-medium whitespace-nowrap', TONES[tone])}>
      {children}
    </span>
  )
}

export function Banner({ children, tone = 'neutral', title, testId }: { children: ReactNode; tone?: Tone; title?: string; testId?: string }) {
  return (
    <div role="note" data-testid={testId} className={cx('rounded-2xl px-4 py-3 text-[14px] leading-snug', TONES[tone])}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      {children}
    </div>
  )
}

export function Kpi({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="card p-4" data-testid={testId}>
      <div className="text-[12px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1.5 text-[19px] leading-tight font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-[12.5px] leading-snug text-muted">{hint}</div>}
    </div>
  )
}

/** Barra proporcional. value null → hachurado neutro (lacuna visível, sem cor que a disfarce). */
export function Bar({ value, max, label }: { value: number | null; max: number | null; label?: string }) {
  if (value === null || !max) {
    return <div className="gap-pattern h-1.5 w-full rounded-full" aria-label={label ?? 'sem valor'} />
  }
  const pct = Math.max(2, Math.min(100, (value / max) * 100))
  return (
    <div className="h-1.5 w-full rounded-full bg-[#ecebe7]" aria-hidden>
      <div className="h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Coverage({ done, total }: { done: number; total: number }) {
  const pct = total ? (done / total) * 100 : 0
  return (
    <div className="flex items-center gap-2" aria-label={`${done} de ${total} com valor`}>
      <div className="h-1 flex-1 rounded-full bg-gap-soft">
        <div className="h-1 rounded-full bg-ink-2" style={{ width: `${pct}%` }} />
      </div>
      <span className="num text-[12px] text-muted">
        {done}/{total}
      </span>
    </div>
  )
}

export function Segmented({ options, label }: { options: Array<{ href: string; label: string; active: boolean; testId?: string }>; label: string }) {
  return (
    <nav aria-label={label} className="flex rounded-xl border border-line-strong bg-surface p-1">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          scroll={false}
          replace
          data-testid={o.testId}
          aria-current={o.active ? 'true' : undefined}
          className={cx('tap flex flex-1 items-center justify-center rounded-lg px-2 text-center text-[14px] font-medium', o.active ? 'bg-ink text-white' : 'text-ink-2')}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  )
}

export function Chips({ options, label }: { options: Array<{ href: string; label: string; active: boolean; count?: number; testId?: string }>; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          scroll={false}
          replace
          data-testid={o.testId}
          aria-current={o.active ? 'true' : undefined}
          className={cx(
            'tap inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 text-[14px] font-medium whitespace-nowrap',
            o.active ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-2',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={cx('num text-[12px]', o.active ? 'text-white/75' : 'text-muted')}>{o.count}</span>}
        </Link>
      ))}
    </nav>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card px-5 py-8 text-center" data-testid="empty-state">
      <div className="text-[16px] font-semibold text-ink">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ListLink({ href, children, testId, className }: { href: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <Link href={href} data-testid={testId} className={cx('tap block px-4 py-3.5 active:bg-[#f1f0ec]', className)}>
      {children}
    </Link>
  )
}

export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="card divide-y divide-line">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4 px-4 py-3">
          <dt className="shrink-0 text-[14px] text-muted">{k}</dt>
          <dd className="min-w-0 text-right text-[14.5px] font-medium text-ink [overflow-wrap:anywhere]">{v ?? <span className="font-normal text-gap italic">Não informado</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

export function FlashMessage({ ok, erro }: { ok?: string; erro?: string }) {
  if (!ok && !erro) return null
  return (
    <div className="mb-4" role="status" data-testid="flash">
      <Banner tone={erro ? 'danger' : 'ok'}>{erro ?? ok}</Banner>
    </div>
  )
}
