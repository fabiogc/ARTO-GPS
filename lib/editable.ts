/** Campos editáveis manualmente por entidade → coluna correspondente na tabela importada. */
export const EDITABLE: Record<string, Record<string, string>> = {
  item: { quantity: 'quantity', unitPrice: 'reference_unit_price', priceType: 'price_type', priceDate: 'price_date', source: 'source', confidence: 'confidence', status: 'status', notes: 'notes', scenario: 'scenario' },
  quote: { status: 'status', isReference: 'is_reference', notes: 'notes' },
}
