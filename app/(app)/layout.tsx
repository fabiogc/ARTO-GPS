import Link from 'next/link'
import { headers } from 'next/headers'
import { BottomNav, HistoryTracker } from '@/components/nav'
import { getContext } from '@/lib/data'
import { defaultDbPath } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext()
  const isAdmin = ctx.session.r === 'admin'
  const path = (await headers()).get('x-arto-path') ?? ''
  const allowWithoutData = isAdmin && path === '/importar'
  return (
    <>
      <HistoryTracker />
      <div className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex h-11 max-w-3xl items-center justify-between px-4">
          <span className="text-[13px] font-semibold tracking-[0.18em] text-ink">
            ARTO <span className="font-normal tracking-normal text-muted">· Obras Hospitalares</span>
          </span>
          <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] text-ink-2" data-testid="role-badge">
            {isAdmin ? 'Administrador' : 'Visão do cliente'}
          </span>
        </div>
      </div>
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-[calc(88px+env(safe-area-inset-bottom))]">
        {ctx.missing && !allowWithoutData ? (
          <div className="card p-5">
            <h1 className="text-xl font-semibold">Dados ainda não importados</h1>
            <p className="mt-2 text-[15px] text-muted">
              O banco local não foi encontrado em <code className="text-[13px] break-all">{defaultDbPath()}</code>. Rode <code>npm run import</code> com a planilha V4 em <code>data/private/</code>
              {isAdmin ? ' ou envie a planilha pelo app.' : '. Avise o administrador.'}
            </p>
            {isAdmin && (
              <Link href="/importar" className="btn btn-primary mt-4">
                Importar planilha
              </Link>
            )}
          </div>
        ) : (
          children
        )}
      </main>
      <BottomNav isAdmin={isAdmin} />
    </>
  )
}
