import 'server-only'
import { cache } from 'react'
import { activeScenarioId, buildCostUnits, categorySummaries, summarize, type CalcOptions } from './finance'
import { dbAvailable, loadDataset } from './repo'
import { requireSession } from './session'

/** Carrega dados + cálculos uma vez por requisição. */
export const getContext = cache(async () => {
  const session = await requireSession()
  if (!dbAvailable()) return { session, missing: true as const }
  const ds = loadDataset()
  const opts: CalcOptions = { activeScenario: activeScenarioId(ds), includeMedicalEquipment: true }
  const units = buildCostUnits(ds, opts)
  const summary = summarize(ds, opts, units)
  const cats = categorySummaries(ds, opts, units)
  const unitByItem = new Map(units.flatMap((u) => u.itemCodes.map((c) => [c, u] as const)))
  return { session, missing: false as const, isAdmin: session.r === 'admin', ds, opts, units, unitByItem, summary, cats }
})

export type Ctx = Exclude<Awaited<ReturnType<typeof getContext>>, { missing: true }>

export async function getReadyContext(): Promise<Ctx> {
  const c = await getContext()
  if (c.missing) throw new Error('Banco de dados não importado. Rode "npm run import".')
  return c
}
