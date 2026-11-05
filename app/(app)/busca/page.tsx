import type { Metadata } from 'next'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { BackButton } from '@/components/nav'
import { Badge, Money, PageHeader, Section } from '@/components/ui'
import { getReadyContext } from '@/lib/data'
import { norm } from '@/lib/import/rules'
import { quoteAmountLabel } from '@/lib/labels'

export const metadata: Metadata = { title: 'Busca' }

export default async function Busca({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams
  const q = (sp.q ?? '').slice(0, 80)
  const { ds, isAdmin, unitByItem } = await getReadyContext()
  const terms = norm(q).split(' ').filter(Boolean)
  const match = (...fields: Array<string | null | undefined>) => {
    const hay = norm(fields.filter(Boolean).join(' '))
    return terms.length > 0 && terms.every((t) => hay.includes(t))
  }
  const cats = ds.categories.filter((c) => match(c.code, c.name))
  const items = ds.items.filter((i) => match(i.code, i.description, i.categoryName, i.source, i.notes, isAdmin ? i.supplierChosen : null))
  const quotes = isAdmin ? ds.quotes.filter((x) => match(x.id, x.supplier, x.service, x.packageRaw, x.scope, x.itemCodes.join(' '))) : []
  const total = cats.length + items.length + quotes.length

  return (
    <>
      <PageHeader back={<BackButton fallback="/mais" label="Mais" />} title="Busca" subtitle={isAdmin ? 'Código, serviço, disciplina ou fornecedor' : 'Código, serviço ou disciplina'} />
      <form action="/busca" method="get" role="search" className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          Termo de busca
        </label>
        <input id="q" name="q" type="search" defaultValue={q} autoFocus={!q} placeholder="ex.: 12.006, HVAC, fornecedor, gases" className="field flex-1" data-testid="search-input" enterKeyHint="search" />
        <button type="submit" className="btn btn-primary" aria-label="Buscar" data-testid="search-submit">
          <Search size={18} aria-hidden />
        </button>
      </form>

      {!q ? (
        <p className="mt-6 text-center text-[14px] text-muted">Digite ao menos um termo. Acentos e maiúsculas são ignorados.</p>
      ) : total === 0 ? (
        <div className="card mt-6 p-5 text-center" data-testid="empty-state">
          <div className="font-semibold">Nada encontrado para “{q}”</div>
          <div className="mt-1 text-[14px] text-muted">Tente o código (ex.: 06.004), parte do nome ou a disciplina.</div>
        </div>
      ) : (
        <div data-testid="search-results">
          <p className="mt-4 px-1 text-[13px] text-muted">{total} resultado(s)</p>
          {cats.length > 0 && (
            <Section title="Macroetapas">
              <ul className="card divide-y divide-line">
                {cats.map((c) => (
                  <li key={c.code}>
                    <Link href={`/custos/${c.code}`} className="tap block px-4 py-3 font-medium active:bg-[#f1f0ec]">
                      <span className="num mr-1.5 text-muted">{c.code}</span>
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {items.length > 0 && (
            <Section title={`Pacotes (${items.length})`}>
              <ul className="card divide-y divide-line">
                {items.slice(0, 60).map((i) => {
                  const u = unitByItem.get(i.code)
                  return (
                    <li key={i.code}>
                      <Link href={`/itens/${i.code}`} className="tap block px-4 py-3 active:bg-[#f1f0ec]" data-testid={`result-item-${i.code}`}>
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-medium">
                            <span className="num mr-1.5 text-muted">{i.code}</span>
                            {i.description}
                          </span>
                          <span className="shrink-0 text-[14px] font-semibold">{u && u.itemCodes.length > 1 ? <span className="font-medium text-ink-2">Em grupo</span> : <Money value={u?.estimate ?? null} />}</span>
                        </div>
                        <div className="text-[12.5px] text-muted">{i.categoryName}</div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
              {items.length > 60 && <p className="mt-2 px-1 text-[13px] text-muted">Mostrando 60 de {items.length}. Refine a busca.</p>}
            </Section>
          )}
          {quotes.length > 0 && (
            <Section title={`Propostas (${quotes.length})`}>
              <ul className="card divide-y divide-line">
                {quotes.map((x) => (
                  <li key={x.id}>
                    <Link href={`/propostas/${encodeURIComponent(x.id)}`} className="tap block px-4 py-3 active:bg-[#f1f0ec]" data-testid={`result-quote-${x.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-medium">{x.supplier}</span>
                        <span className="shrink-0 text-[14px] font-semibold">{quoteAmountLabel(x)}</span>
                      </div>
                      <div className="text-[12.5px] text-muted">{x.service}</div>
                      {x.isVerbal && <Badge tone="warn">Informado verbalmente</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  )
}
