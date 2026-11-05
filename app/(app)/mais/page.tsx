import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, ChevronRight, Download, FileSearch, FileUp, Layers, LogOut, Scale, Search, Sheet, TriangleAlert } from 'lucide-react'
import { logoutAction } from '@/app/actions'
import { PageHeader, Section } from '@/components/ui'
import { getReadyContext } from '@/lib/data'

export const metadata: Metadata = { title: 'Mais' }

export default async function Mais() {
  const { session, isAdmin, ds, summary } = await getReadyContext()
  const links = [
    { href: '/busca', label: 'Busca global', hint: 'Código, serviço, disciplina ou fornecedor', icon: Search, admin: false },
    { href: '/pendencias', label: 'Pendências críticas', hint: `${ds.pendencias.length} pendências · ${summary.unpricedItems} pacotes sem preço`, icon: TriangleAlert, admin: false },
    { href: '/acompanhamento', label: 'Estimado × contratado × realizado', hint: summary.contractCount ? `${summary.contractCount} contrato(s)` : 'Nenhum contrato registrado', icon: Scale, admin: true },
    { href: '/cenarios', label: 'Cenários e referências', hint: 'Alternativas estruturais, pesquisa V2, base física', icon: Layers, admin: false },
    { href: '/cronograma', label: 'Cronograma de marcos', hint: `${ds.milestones.length} marcos`, icon: CalendarDays, admin: false },
    { href: '/relatorio', label: 'Relatório de importação e cobertura', hint: 'Divergências, fontes, alertas, conflitos', icon: FileSearch, admin: true },
    { href: '/importar', label: 'Importar nova versão da planilha', hint: 'Simula o impacto antes de aplicar', icon: FileUp, admin: true },
    { href: '/planilha', label: 'Planilha original (somente leitura)', hint: '17 abas preservadas linha a linha', icon: Sheet, admin: true },
  ].filter((l) => isAdmin || !l.admin)

  return (
    <>
      <PageHeader title="Mais" subtitle={`Conectado como ${session.u} · ${isAdmin ? 'administrador' : 'cliente'}`} />
      <ul className="card divide-y divide-line">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="tap flex items-center gap-3 px-4 py-3.5 active:bg-[#f1f0ec]" data-testid={`more-${l.href.slice(1)}`}>
              <l.icon size={20} className="shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-medium">{l.label}</span>
                <span className="block text-[13px] text-muted">{l.hint}</span>
              </span>
              <ChevronRight size={18} className="text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      {isAdmin && (
        <Section title="Backup e exportação">
          <div className="card divide-y divide-line">
            {[
              ['/api/export?formato=csv', 'Pacotes e estimativas (CSV)'],
              ['/api/export?formato=csv&entidade=propostas', 'Propostas (CSV)'],
              ['/api/export?formato=json', 'Backup completo (JSON)'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="tap flex items-center gap-3 px-4 py-3.5 active:bg-[#f1f0ec]" download>
                <Download size={20} className="text-accent" aria-hidden />
                <span className="text-[15px] font-medium">{label}</span>
              </a>
            ))}
          </div>
        </Section>
      )}

      <Section>
        <form action={logoutAction}>
          <button type="submit" className="btn btn-secondary w-full" data-testid="logout">
            <LogOut size={18} aria-hidden /> Sair
          </button>
        </form>
        <p className="mt-4 text-center text-[12px] text-muted">
          ARTO | Gerenciamento de Obras Hospitalares · fonte: {ds.project.sourceFile}
        </p>
      </Section>
    </>
  )
}
