/**
 * Filtra o Dataset para o papel "cliente".
 * - Propostas internas da ARTO (gerenciamento de obra) são removidas por completo.
 * - Textos de fonte/observação que citem fornecedores dessas propostas são ocultados.
 * - Pendências exclusivamente de gerenciamento (escopo ARTO) não aparecem.
 */
import { norm } from './import/rules'
import type { Dataset } from './types'

export function clientView(ds: Dataset): Dataset {
  const internal = ds.quotes.filter((q) => q.isInternal)
  const names = [...new Set(internal.map((q) => q.supplier).filter((s): s is string => Boolean(s)))]
    .map((s) => norm(s).split(' ')[0])
    .filter((s) => s.length >= 3)
  const mentions = (t: string | null) => (t ? names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(norm(t))) : false)
  return {
    ...ds,
    quotes: ds.quotes.filter((q) => !q.isInternal),
    items: ds.items.map((i) => ({
      ...i,
      source: mentions(i.source) ? null : i.source,
      notes: mentions(i.notes) ? null : i.notes,
      supplierChosen: null,
    })),
    pendencias: ds.pendencias.filter((p) => !(p.groups.length > 0 && p.groups.every((g) => g === '03') && /gerenciam/.test(norm(p.title)))),
  }
}
