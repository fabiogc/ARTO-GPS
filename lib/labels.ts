import type { EstimateSource } from './finance'
import { formatBRL } from './format'
import type { AmountKind, PriceType, Quote, QuoteStatus, Scenario } from './types'

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  solicitada: 'Solicitada / aguardando',
  recebida: 'Recebida',
  em_analise: 'Em análise',
  negociacao: 'Negociação',
  aprovada: 'Aprovada',
  contratada: 'Contratada',
  descartada: 'Descartada',
}
export const QUOTE_STATUS_ORDER: QuoteStatus[] = ['solicitada', 'recebida', 'em_analise', 'negociacao', 'aprovada', 'contratada', 'descartada']

export const PRICE_TYPE_LABEL: Record<PriceType, string> = {
  proposta: 'Proposta',
  contrato: 'Contrato',
  sinapi: 'SINAPI',
  referencia: 'Referência',
  parametrica: 'Estimativa paramétrica',
  verbal: 'Informação verbal',
  estimativa: 'Estimativa',
}

export const SCENARIO_LABEL: Record<Scenario, string> = {
  base: 'Base (todas as soluções)',
  concreto: 'Alternativa — concreto',
  metalica: 'Alternativa — metálica',
  lsf: 'Alternativa — LSF',
  a_definir: 'A definir',
}

export const ESTIMATE_SOURCE_LABEL: Record<EstimateSource, string> = {
  contrato: 'Contrato',
  proposta: 'Proposta (não contratada)',
  referencia: 'Orçamento de referência',
}

export const AMOUNT_KIND_LABEL: Record<AmountKind, string> = {
  global: 'Valor global',
  unitario: 'Preço unitário',
  mensal: 'Valor mensal',
  opcional: 'Opcional',
  sem_valor: 'Sem valor',
}

export const CONFIDENCE_LABEL = { alta: 'Alta', media: 'Média', baixa: 'Baixa' } as const

/** Valor da proposta com unidade explícita — nunca apresenta tarifa como total. */
export function quoteAmountLabel(q: Pick<Quote, 'amount' | 'amountKind' | 'unitLabel'>): string {
  if (q.amount === null) return 'Sem valor informado'
  const v = formatBRL(q.amount)
  if (q.amountKind === 'unitario') return `${v} ${q.unitLabel === 'R$/dia' ? '/ dia' : q.unitLabel ?? '/ unid.'}`
  if (q.amountKind === 'mensal') return `${v} / mês`
  return v
}
