import { NextResponse } from 'next/server'
import { authConfigured } from '@/lib/auth-core'
import { dbAvailable } from '@/lib/repo'

export const dynamic = 'force-dynamic'

/** Saúde do serviço — não expõe dados. */
export function GET() {
  return NextResponse.json({ ok: true, db: dbAvailable(), auth: authConfigured() })
}
