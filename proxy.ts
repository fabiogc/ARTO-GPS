import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, isAdminOnly, verifyToken } from './lib/auth-core'

/** Toda a aplicação exige sessão; rotas sensíveis exigem papel admin. */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const session = verifyToken(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
    const url = new URL('/login', req.url)
    if (pathname !== '/') url.searchParams.set('next', pathname + search)
    return NextResponse.redirect(url)
  }
  if (session.r !== 'admin' && isAdminOnly(pathname)) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'acesso negado' }, { status: 403 })
    return NextResponse.redirect(new URL('/?negado=1', req.url))
  }
  // Informa o caminho ao layout (ex.: liberar /importar quando ainda não há banco)
  const headers = new Headers(req.headers)
  headers.set('x-arto-path', pathname)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/((?!login|api/health|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
}
