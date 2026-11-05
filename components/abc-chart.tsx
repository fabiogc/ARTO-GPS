'use client'

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface AbcPoint {
  key: string
  short: string
  label: string
  value: number
  valueLabel: string
  pctLabel: string
  cumLabel: string
  cls: 'A' | 'B' | 'C'
}

// Rampa sequencial de um só matiz (A = mais escuro). Identidade da classe também vai no texto.
export const CLASS_COLOR = { A: '#0e5a61', B: '#3c8b91', C: '#9cc6c9' } as const

export function AbcChart({ data }: { data: AbcPoint[] }) {
  const height = Math.max(120, data.length * 38 + 16)
  return (
    <div style={{ height }} role="img" aria-label={`Gráfico de barras horizontais com ${data.length} entradas da curva ABC. Valores completos na tabela abaixo.`} data-testid="abc-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }} barCategoryGap={6}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="short" width={118} tickLine={false} axisLine={false} tick={{ fill: '#3b4855', fontSize: 12 }} interval={0} />
          <Tooltip
            cursor={{ fill: 'rgba(21,33,43,0.05)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as AbcPoint
              return (
                <div className="max-w-[240px] rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] shadow-lg">
                  <div className="font-semibold text-ink">{p.label}</div>
                  <div className="num mt-1 text-ink">{p.valueLabel}</div>
                  <div className="text-muted">
                    {p.pctLabel} individual · {p.cumLabel} acumulado · classe {p.cls}
                  </div>
                </div>
              )
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.key} fill={CLASS_COLOR[d.cls]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
