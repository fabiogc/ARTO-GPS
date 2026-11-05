'use client'

import { BarChart3, ChevronLeft, FileText, Home, ListTree, MoreHorizontal, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

const KEY = 'arto_nav_stack'

function readStack(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}
function writeStack(s: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s.slice(-50)))
  } catch {
    /* modo privado: segue sem histórico, botão voltar usa o destino padrão */
  }
}

/**
 * Registra a navegação interna (por caminho). Filtros usam `replace` e não criam entradas.
 * Permite que “Voltar” use o histórico real quando existe, e um destino lógico quando a
 * página foi aberta diretamente (link compartilhado, recarga, app na tela inicial do iPhone).
 */
export function HistoryTracker() {
  const pathname = usePathname()
  useEffect(() => {
    const s = readStack()
    if (s[s.length - 1] === pathname) return
    if (s[s.length - 2] === pathname) s.pop()
    else s.push(pathname)
    writeStack(s)
  }, [pathname])
  return null
}

export function BackButton({ fallback, label = 'Voltar' }: { fallback: string; label?: string }) {
  const router = useRouter()
  return (
    <a
      href={fallback}
      data-testid="back-button"
      onClick={(e) => {
        e.preventDefault()
        const s = readStack()
        if (s.length >= 2) router.back()
        else router.push(fallback)
      }}
      className="tap -ml-2 mb-1 inline-flex items-center gap-0.5 rounded-lg pr-3 pl-1 text-[16px] font-medium text-accent active:opacity-60"
    >
      <ChevronLeft size={22} aria-hidden />
      {label}
    </a>
  )
}

export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname()
  const tabs = [
    { href: '/', label: 'Visão geral', icon: Home, match: (p: string) => p === '/' },
    { href: '/custos', label: 'Custos', icon: ListTree, match: (p: string) => p.startsWith('/custos') || p.startsWith('/itens') },
    { href: '/abc', label: 'Curva ABC', icon: BarChart3, match: (p: string) => p.startsWith('/abc') },
    isAdmin
      ? { href: '/propostas', label: 'Propostas', icon: FileText, match: (p: string) => p.startsWith('/propostas') }
      : { href: '/pendencias', label: 'Pendências', icon: TriangleAlert, match: (p: string) => p.startsWith('/pendencias') },
    { href: '/mais', label: 'Mais', icon: MoreHorizontal, match: (p: string) => !['/', '/custos', '/itens', '/abc', '/propostas'].some((x) => (x === '/' ? p === '/' : p.startsWith(x))) && !(isAdmin ? false : p.startsWith('/pendencias')) },
  ]
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {tabs.map((t) => {
          const active = t.match(pathname)
          const Icon = t.icon
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                data-testid={`tab-${t.href === '/' ? 'inicio' : t.href.slice(1)}`}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? 'text-accent' : 'text-muted'}`}
              >
                <Icon size={22} strokeWidth={active ? 2.3 : 1.8} aria-hidden />
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
