import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, verifyToken, type Session } from './auth-core'

export async function getSession(): Promise<Session | null> {
  const jar = await cookies()
  return verifyToken(jar.get(SESSION_COOKIE)?.value)
}

export async function requireSession(): Promise<Session> {
  const s = await getSession()
  if (!s) redirect('/login')
  return s
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession()
  if (s.r !== 'admin') redirect('/?negado=1')
  return s
}
