import { setScenarioAction } from '@/app/actions'
import type { ScenarioDef } from '@/lib/types'

/** Seleção do cenário estrutural ativo (exclusivo). Formulário nativo: funciona sem JavaScript. */
export function ScenarioForm({ scenarios, returnTo }: { scenarios: ScenarioDef[]; returnTo: string }) {
  const active = scenarios.find((s) => s.isActive)?.id ?? 'nenhum'
  return (
    <form action={setScenarioAction} className="card mt-3 p-4" data-testid="scenario-form">
      <input type="hidden" name="return" value={returnTo} />
      <label htmlFor="scenario-select" className="block text-[14px] font-medium">
        Cenário estrutural ativo (mutuamente excludente)
      </label>
      <div className="mt-2 flex gap-2">
        <select id="scenario-select" name="scenario" defaultValue={active} className="field flex-1">
          <option value="nenhum">Nenhum (alternativas fora dos totais)</option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.comparability ? ` — ${s.comparability}` : ''}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">
          Aplicar
        </button>
      </div>
    </form>
  )
}
