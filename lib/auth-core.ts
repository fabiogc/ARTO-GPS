/**
 * Núcleo de autenticação sem dependências do Next (usado pelo proxy, ações e scripts).
 * Senhas: scrypt com sal aleatório. Sessão: token assinado HMAC-SHA256 em cookie HttpOnly.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Role } from './types'

export const SESSION_COOKIE = 'arto_session'
export const SESSION_TTL_SECONDS = 12 * 60 * 60

// ':' e não '$': o carregador de .env do Next expande '$' mesmo entre aspas.
const SEP = ':'

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 })
  return ['scrypt', '16384', '8', '1', salt.toString('base64url'), hash.toString('base64url')].join(SEP)
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false
  const parts = stored.split(/[:$]/)
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, N, r, p, saltB64, hashB64] = parts
  const expected = Buffer.from(hashB64, 'base64url')
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export interface Session {
  u: string
  r: Role
  exp: number
}

function secret(): string | null {
  const s = process.env.SESSION_SECRET
  return s && s.length >= 32 ? s : null
}

export function authConfigured(): boolean {
  return Boolean(secret() && (process.env.ADMIN_PASSWORD_HASH || process.env.CLIENT_PASSWORD_HASH))
}

const sign = (payload: string, key: string) => createHmac('sha256', key).update(payload).digest('base64url')

export function createToken(user: string, role: Role, nowSec = Math.floor(Date.now() / 1000)): string {
  const key = secret()
  if (!key) throw new Error('SESSION_SECRET ausente ou curto (mín. 32 caracteres)')
  const payload = Buffer.from(JSON.stringify({ u: user, r: role, exp: nowSec + SESSION_TTL_SECONDS } satisfies Session)).toString('base64url')
  return `${payload}.${sign(payload, key)}`
}

export function verifyToken(token: string | undefined, nowSec = Math.floor(Date.now() / 1000)): Session | null {
  const key = secret()
  if (!token || !key) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = Buffer.from(sign(payload, key))
  const got = Buffer.from(sig)
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session
    if (typeof s.exp !== 'number' || s.exp < nowSec) return null
    if (s.r !== 'admin' && s.r !== 'cliente') return null
    return s
  } catch {
    return null
  }
}

const DUMMY_HASH = hashPassword('dummy-password-for-timing')

export function authenticate(username: string, password: string): { user: string; role: Role } | null {
  const users: Array<{ name: string; hash: string | undefined; role: Role }> = [
    { name: process.env.ADMIN_USERNAME || 'admin', hash: process.env.ADMIN_PASSWORD_HASH, role: 'admin' },
    { name: process.env.CLIENT_USERNAME || 'cliente', hash: process.env.CLIENT_PASSWORD_HASH, role: 'cliente' },
  ]
  const u = users.find((x) => x.hash && x.name === username.trim())
  // Executa scrypt mesmo para usuário inexistente (tempo aproximadamente constante)
  const ok = verifyPassword(password, u?.hash ?? DUMMY_HASH)
  return u && ok ? { user: u.name, role: u.role } : null
}

/** Rotas que o papel "cliente" não pode acessar (propostas, fornecedores e dados internos). */
export const ADMIN_ONLY_PREFIXES = ['/propostas', '/relatorio', '/planilha', '/api/export', '/acompanhamento']

export function isAdminOnly(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
