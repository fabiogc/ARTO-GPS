const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Normaliza o espaço não separável do Intl para espaço comum (evita quebras estranhas em testes). */
const clean = (s: string) => s.replace(/ | /g, ' ')

export const NOT_PRICED = 'Não precificado'

export function formatBRL(v: number | null | undefined, empty = NOT_PRICED): string {
  if (v === null || v === undefined || Number.isNaN(v)) return empty
  return clean(brl.format(v))
}

export function formatBRLCompact(v: number | null | undefined, empty = '—'): string {
  if (v === null || v === undefined) return empty
  return clean(brlCompact.format(v))
}

export function formatNumber(v: number | null | undefined, empty = '—'): string {
  if (v === null || v === undefined) return empty
  return clean(num.format(v))
}

export function formatPct(v: number | null | undefined, empty = '—'): string {
  if (v === null || v === undefined || Number.isNaN(v)) return empty
  return clean(pct.format(v))
}

/** Aceita 'aaaa-mm-dd', ISO completo ou Date. Saída dd/mm/aaaa. */
export function formatDate(v: string | Date | null | undefined, empty = '—'): string {
  if (!v) return empty
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
    if (m) return `${m[3]}/${m[2]}/${m[1]}`
    return v
  }
  const d = v
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return clean(
    new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' }).format(d),
  )
}

/** Converte texto pt-BR ("1.234,56", "R$ 12.000") em número. Retorna null se não for numérico. */
export function parseBRNumber(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  const s = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (s === '') return null
  let normalized = s
  if (/,\d{1,}$/.test(s) || s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}
