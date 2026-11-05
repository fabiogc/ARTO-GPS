import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { loginAction } from '@/app/actions'
import { authConfigured } from '@/lib/auth-core'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Entrar' }
export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  credenciais: 'Usuário ou senha incorretos.',
  bloqueado: 'Muitas tentativas. Aguarde 5 minutos e tente de novo.',
  config: 'Autenticação não configurada no servidor (SESSION_SECRET e hashes de senha). Veja o README.',
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string; next?: string }> }) {
  const sp = await searchParams
  if (await getSession()) redirect(sp.next?.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/')
  const configured = authConfigured()
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <div className="text-[13px] font-semibold tracking-[0.22em] text-ink">ARTO</div>
        <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-tight">Gerenciamento de Obras Hospitalares</h1>
        <p className="mt-2 text-[15px] text-muted">Acesso restrito. Dados de custos e fornecedores são confidenciais.</p>
      </div>
      {(sp.erro || !configured) && (
        <div role="alert" className="mb-4 rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger" data-testid="login-error">
          {ERRORS[sp.erro ?? 'config'] ?? 'Não foi possível entrar.'}
        </div>
      )}
      <form action={loginAction} className="card space-y-4 p-5">
        <input type="hidden" name="next" value={sp.next ?? '/'} />
        <label className="block">
          <span className="mb-1 block text-[14px] font-medium">Usuário</span>
          <input name="username" autoComplete="username" autoCapitalize="none" required className="field" data-testid="login-user" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[14px] font-medium">Senha</span>
          <input name="password" type="password" autoComplete="current-password" required className="field" data-testid="login-password" />
        </label>
        <button type="submit" className="btn btn-primary w-full" data-testid="login-submit">
          Entrar
        </button>
      </form>
    </main>
  )
}
