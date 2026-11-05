/** Gera .env.local com segredo e senhas aleatórias (exibidas uma única vez). Não sobrescreve sem --force. */
import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { hashPassword } from '../lib/auth-core'

if (existsSync('.env.local') && !process.argv.includes('--force')) {
  console.error('.env.local já existe. Use --force para regenerar (invalida as senhas atuais).')
  process.exit(1)
}
const pw = () => randomBytes(12).toString('base64url')
const adminPw = pw()
const clientPw = pw()
const env = [
  `SESSION_SECRET=${randomBytes(32).toString('base64url')}`,
  'ADMIN_USERNAME=admin',
  `ADMIN_PASSWORD_HASH=${hashPassword(adminPw)}`,
  'CLIENT_USERNAME=cliente',
  `CLIENT_PASSWORD_HASH=${hashPassword(clientPw)}`,
  'DATABASE_PATH=data/private/arto.db',
  '',
].join('\n')
writeFileSync('.env.local', env, { mode: 0o600 })
console.log('✔ .env.local criado (não versionado). Guarde estas senhas — não serão exibidas de novo:')
console.log(`  admin   / ${adminPw}`)
console.log(`  cliente / ${clientPw}`)
