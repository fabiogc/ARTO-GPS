'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, authConfigured, authenticate, createToken } from '@/lib/auth-core'
import { parseBRNumber } from '@/lib/format'
import { addContract, addMeasurement, loadDataset, resolveConflict, setActiveScenario, setOverrides } from '@/lib/repo'
import { requireAdmin } from '@/lib/session'
import type { Confidence, PriceType, QuoteStatus, Scenario, StructuralScenario } from '@/lib/types'

const safeNext = (n: unknown) => {
  const s = typeof n === 'string' ? n : ''
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/login') ? s : '/'
}
const str = (f: FormData, k: string) => {
  const v = f.get(k)
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}
const back = (path: string, msg: { ok?: string; erro?: string }) => {
  const q = new URLSearchParams(msg as Record<string, string>).toString()
  redirect(`${path}${path.includes('?') ? '&' : '?'}${q}`)
}

// Tentativas de login por usuário (memória do processo) — mitigação simples de força bruta.
const attempts = new Map<string, { n: number; until: number }>()

export async function loginAction(formData: FormData) {
  const user = str(formData, 'username') ?? ''
  const pass = typeof formData.get('password') === 'string' ? String(formData.get('password')) : ''
  const next = safeNext(formData.get('next'))
  if (!authConfigured()) redirect('/login?erro=config')
  const a = attempts.get(user)
  if (a && a.until > Date.now()) redirect(`/login?erro=bloqueado&next=${encodeURIComponent(next)}`)
  const ok = authenticate(user, pass)
  if (!ok) {
    const n = (a?.n ?? 0) + 1
    attempts.set(user, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 })
    redirect(`/login?erro=credenciais&next=${encodeURIComponent(next)}`)
  }
  attempts.delete(user)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, createToken(ok.user, ok.role), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  redirect(next)
}

export async function logoutAction() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  redirect('/login')
}

const PRICE_TYPES: PriceType[] = ['proposta', 'contrato', 'sinapi', 'referencia', 'parametrica', 'verbal', 'estimativa']
const CONFIDENCES: Confidence[] = ['alta', 'media', 'baixa']
const SCENARIOS: Scenario[] = ['base', 'concreto', 'metalica', 'lsf', 'a_definir']
const QUOTE_STATUSES: QuoteStatus[] = ['solicitada', 'recebida', 'em_analise', 'negociacao', 'aprovada', 'contratada', 'descartada']

export async function updateItemAction(formData: FormData) {
  const s = await requireAdmin()
  const code = str(formData, 'code')
  if (!code) throw new Error('Código ausente')
  const path = `/itens/${encodeURIComponent(code)}`
  const numField = (k: string) => {
    const raw = str(formData, k)
    if (raw === null) return { ok: true as const, v: null }
    const n = parseBRNumber(raw)
    return n === null || n < 0 ? { ok: false as const, v: null } : { ok: true as const, v: n }
  }
  const qty = numField('quantity')
  const price = numField('unitPrice')
  if (!qty.ok || !price.ok) back(path, { erro: 'Quantidade e preço devem ser números não negativos (ex.: 1.234,56). Deixe vazio para “não informado”.' })
  const priceType = str(formData, 'priceType') as PriceType | null
  const confidence = str(formData, 'confidence') as Confidence | null
  const scenario = (str(formData, 'scenario') ?? 'base') as Scenario
  const priceDate = str(formData, 'priceDate')
  if (priceType && !PRICE_TYPES.includes(priceType)) back(path, { erro: 'Tipo de preço inválido' })
  if (confidence && !CONFIDENCES.includes(confidence)) back(path, { erro: 'Confiabilidade inválida' })
  if (!SCENARIOS.includes(scenario)) back(path, { erro: 'Cenário inválido' })
  if (priceDate && !/^\d{4}-\d{2}-\d{2}$/.test(priceDate)) back(path, { erro: 'Data-base inválida' })
  if (price.v !== null && !priceType) back(path, { erro: 'Informe o tipo do preço (proposta, SINAPI, referência…) ao lançar um valor.' })
  const n = setOverrides(
    'item',
    code,
    { quantity: qty.v, unitPrice: price.v, priceType, priceDate, source: str(formData, 'source'), confidence, status: str(formData, 'status') ?? '', notes: str(formData, 'notes'), scenario },
    s.u,
  )
  revalidatePath('/', 'layout')
  back(path, { ok: n ? `${n} campo(s) atualizado(s). A planilha original não foi alterada.` : 'Nenhuma alteração.' })
}

export async function updateQuoteAction(formData: FormData) {
  const s = await requireAdmin()
  const id = str(formData, 'id')
  if (!id) throw new Error('ID ausente')
  const path = `/propostas/${encodeURIComponent(id)}`
  const status = str(formData, 'status') as QuoteStatus | null
  if (!status || !QUOTE_STATUSES.includes(status)) back(path, { erro: 'Status inválido' })
  if (status === 'contratada') {
    const ds = loadDataset()
    if (!ds.contracts.some((c) => c.quoteId === id)) back(path, { erro: 'Para marcar como contratada, registre o contrato abaixo (valor e data). O contratado só entra com contrato explícito.' })
  }
  const n = setOverrides('quote', id, { status, isReference: formData.get('isReference') === 'on', isInternal: formData.get('isInternal') === 'on', notes: str(formData, 'notes') }, s.u)
  revalidatePath('/', 'layout')
  back(path, { ok: n ? 'Proposta atualizada.' : 'Nenhuma alteração.' })
}

export async function setScenarioAction(formData: FormData) {
  const s = await requireAdmin()
  const v = str(formData, 'scenario')
  const ret = safeNext(formData.get('return'))
  const id = v === 'nenhum' || !v ? null : (v as StructuralScenario)
  if (id && !['concreto', 'metalica', 'lsf'].includes(id)) back(ret, { erro: 'Cenário inválido' })
  setActiveScenario(id, s.u)
  revalidatePath('/', 'layout')
  back(ret, { ok: id ? 'Cenário estrutural ativo atualizado. As demais alternativas foram excluídas dos totais.' : 'Nenhum cenário estrutural ativo: alternativas fora dos totais.' })
}

export async function createContractAction(formData: FormData) {
  const s = await requireAdmin()
  const quoteId = str(formData, 'quoteId')
  const path = quoteId ? `/propostas/${encodeURIComponent(quoteId)}` : '/acompanhamento'
  const ds = loadDataset()
  const q = quoteId ? ds.quotes.find((x) => x.id === quoteId) : null
  const amount = parseBRNumber(str(formData, 'amount'))
  if (amount === null || amount <= 0) back(path, { erro: 'Informe o valor contratado (maior que zero).' })
  if (formData.get('confirm') !== 'on') back(path, { erro: 'Confirme que existe contrato assinado/aprovado.' })
  const itemCodes = q ? q.itemCodes : (str(formData, 'items') ?? '').split(/[\s,;]+/).filter(Boolean)
  if (!itemCodes.length || itemCodes.some((c) => !ds.items.some((i) => i.code === c))) back(path, { erro: 'Proposta sem pacote válido: corrija o vínculo antes de registrar contrato.' })
  const signedAt = str(formData, 'signedAt')
  if (signedAt && !/^\d{4}-\d{2}-\d{2}$/.test(signedAt)) back(path, { erro: 'Data inválida' })
  const id = addContract({ itemCodes, quoteId, supplier: q?.supplier ?? str(formData, 'supplier'), object: q?.service ?? str(formData, 'object') ?? 'Contrato', amount: amount!, signedAt, documentRef: str(formData, 'documentRef'), notes: str(formData, 'notes') }, s.u)
  revalidatePath('/', 'layout')
  back(path, { ok: `Contrato ${id} registrado.` })
}

export async function createMeasurementAction(formData: FormData) {
  const s = await requireAdmin()
  const contractId = str(formData, 'contractId')
  const path = '/acompanhamento'
  if (!contractId) back(path, { erro: 'Contrato ausente' })
  const period = str(formData, 'period')
  if (!period) back(path, { erro: 'Informe o período (ex.: 2027-01).' })
  const measured = parseBRNumber(str(formData, 'measured'))
  const paid = parseBRNumber(str(formData, 'paid'))
  try {
    addMeasurement({ contractId: contractId!, period: period!, measured, paid }, s.u)
  } catch (e) {
    back(path, { erro: (e as Error).message })
  }
  revalidatePath('/', 'layout')
  back(path, { ok: 'Medição registrada.' })
}

export async function resolveConflictAction(formData: FormData) {
  const s = await requireAdmin()
  const id = Number(formData.get('id'))
  const decision = formData.get('decision') === 'accept-import' ? 'accept-import' : 'keep-manual'
  resolveConflict(id, decision, s.u)
  revalidatePath('/', 'layout')
  back('/relatorio', { ok: 'Conflito resolvido.' })
}

// ---------------------------------------------------------------------------
// Reimportação da planilha pelo app (admin)
// ---------------------------------------------------------------------------

const cleanName = (n: string) => n.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120)

export async function uploadWorkbookAction(formData: FormData) {
  await requireAdmin()
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) back('/importar', { erro: 'Selecione a planilha .xlsx.' })
  const f = file as File
  let sha = ''
  try {
    const { storeUpload } = await import('@/lib/import/service')
    sha = storeUpload(Buffer.from(await f.arrayBuffer()), f.name)
  } catch (e) {
    back('/importar', { erro: (e as Error).message })
  }
  redirect(`/importar?arquivo=${sha}&nome=${encodeURIComponent(cleanName(f.name))}`)
}

export async function applyWorkbookAction(formData: FormData) {
  const s = await requireAdmin()
  const sha = str(formData, 'arquivo') ?? ''
  const name = cleanName(str(formData, 'nome') ?? 'planilha.xlsx')
  const r = str(formData, 'resolucao')
  const resolution = r === 'keep-manual' || r === 'accept-import' ? r : 'ask'
  if (formData.get('confirm') !== 'on') back(`/importar?arquivo=${sha}&nome=${encodeURIComponent(name)}`, { erro: 'Confirme a importação.' })
  let msg = ''
  try {
    const { commitImport } = await import('@/lib/import/service')
    const rep = await commitImport(sha, resolution, s.u, name)
    const t = Object.values(rep.sync ?? {}).reduce((a, x) => ({ i: a.i + x.inserted, u: a.u + x.updated, d: a.d + x.removed }), { i: 0, u: 0, d: 0 })
    msg = `Importação aplicada: ${t.i} inseridas, ${t.u} atualizadas, ${t.d} removidas${rep.conflicts?.length ? ` · ${rep.conflicts.length} conflito(s)` : ''}.`
  } catch (e) {
    back(`/importar?arquivo=${sha}&nome=${encodeURIComponent(name)}`, { erro: (e as Error).message })
  }
  revalidatePath('/', 'layout')
  back('/relatorio', { ok: msg })
}
