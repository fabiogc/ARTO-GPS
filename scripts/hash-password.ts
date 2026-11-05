import { hashPassword } from '../lib/auth-core'

const pwd = process.argv[2]
if (!pwd || pwd.length < 10) {
  console.error('Uso: npm run hash-password -- "<senha com 10+ caracteres>"')
  process.exit(1)
}
console.log(hashPassword(pwd))
