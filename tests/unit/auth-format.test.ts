import { beforeAll, describe, expect, it } from 'vitest'
import { authenticate, createToken, hashPassword, isAdminOnly, verifyPassword, verifyToken } from '@/lib/auth-core'
import { formatBRL, formatDate, formatPct, parseBRNumber } from '@/lib/format'
import { quoteAmountLabel } from '@/lib/labels'

describe('formatação pt-BR', () => {
  it('BRL, ausência, datas e percentuais', () => {
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50')
    expect(formatBRL(null)).toBe('Não precificado')
    expect(formatBRL(0)).toBe('R$ 0,00')
    expect(formatDate('2026-10-05')).toBe('05/10/2026')
    expect(formatPct(0.0267)).toBe('2,7%')
  })
  it('converte números digitados em pt-BR', () => {
    expect(parseBRNumber('1.234,56')).toBe(1234.56)
    expect(parseBRNumber('R$ 12.000')).toBe(12000)
    expect(parseBRNumber('480')).toBe(480)
    expect(parseBRNumber('abc')).toBeNull()
    expect(parseBRNumber('')).toBeNull()
  })
  it('tarifas e mensais nunca aparecem como total', () => {
    expect(quoteAmountLabel({ amount: 480, amountKind: 'unitario', unitLabel: 'R$/dia' })).toBe('R$ 480,00 / dia')
    expect(quoteAmountLabel({ amount: 12500, amountKind: 'mensal', unitLabel: 'R$/mês' })).toBe('R$ 12.500,00 / mês')
    expect(quoteAmountLabel({ amount: null, amountKind: 'sem_valor', unitLabel: null })).toBe('Sem valor informado')
  })
})

describe('autenticação', () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = 'x'.repeat(40)
    process.env.ADMIN_PASSWORD_HASH = hashPassword('senha-admin-teste')
    process.env.CLIENT_PASSWORD_HASH = hashPassword('senha-cliente-teste')
  })
  it('hash scrypt sem "$" (compatível com .env do Next) e verificação', () => {
    const h = hashPassword('abcdefghij')
    expect(h).not.toContain('$')
    expect(verifyPassword('abcdefghij', h)).toBe(true)
    expect(verifyPassword('errada', h)).toBe(false)
  })
  it('login por papel', () => {
    expect(authenticate('admin', 'senha-admin-teste')).toEqual({ user: 'admin', role: 'admin' })
    expect(authenticate('cliente', 'senha-cliente-teste')).toEqual({ user: 'cliente', role: 'cliente' })
    expect(authenticate('admin', 'senha-cliente-teste')).toBeNull()
  })
  it('token assinado, expirado e adulterado', () => {
    const t = createToken('admin', 'admin', 1000)
    expect(verifyToken(t, 1001)?.r).toBe('admin')
    expect(verifyToken(t, 1000 + 13 * 3600)).toBeNull()
    const [p, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ u: 'x', r: 'admin', exp: 9e9 })).toString('base64url')
    expect(verifyToken(`${forged}.${sig}`, 1001)).toBeNull()
    expect(verifyToken(`${p}.x${sig.slice(1)}`, 1001)).toBeNull()
  })
  it('rotas restritas ao admin', () => {
    expect(isAdminOnly('/propostas')).toBe(true)
    expect(isAdminOnly('/propostas/X')).toBe(true)
    expect(isAdminOnly('/api/export')).toBe(true)
    expect(isAdminOnly('/custos')).toBe(false)
    expect(isAdminOnly('/propostasx')).toBe(false)
  })
})
