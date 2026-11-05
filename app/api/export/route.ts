import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifyToken } from '@/lib/auth-core'
import { activeScenarioId, buildCostUnits, isInScope, referenceTotal } from '@/lib/finance'
import { getDb, loadDataset } from '@/lib/repo'

export const dynamic = 'force-dynamic'

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v)
  // Evita injeção de fórmula ao abrir no Excel
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (header: string[], rows: unknown[][]) => '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')

export async function GET(req: NextRequest) {
  const s = verifyToken(req.cookies.get(SESSION_COOKIE)?.value)
  if (!s) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  if (s.r !== 'admin') return NextResponse.json({ error: 'acesso negado' }, { status: 403 })
  const format = req.nextUrl.searchParams.get('formato') ?? 'json'
  const entity = req.nextUrl.searchParams.get('entidade') ?? 'pacotes'
  const ds = loadDataset()
  const stamp = new Date().toISOString().slice(0, 10)
  const headers = (name: string, type: string) => ({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' })

  if (format === 'csv') {
    if (entity === 'propostas') {
      const rows = ds.quotes.map((q) => [q.id, q.packageRaw, q.itemCodes.join(' '), q.supplier, q.service, q.amount, q.amountKind, q.unitLabel, q.status, q.statusRaw, q.isVerbal ? 'sim' : 'não', q.linkStatus, q.receivedAt, q.documentRef, q.scope])
      return new NextResponse(toCsv(['id', 'pacote_planilha', 'pacotes_vinculados', 'fornecedor', 'servico', 'valor', 'tipo_valor', 'unidade', 'status', 'status_planilha', 'verbal', 'vinculo', 'data', 'documento', 'escopo'], rows), { headers: headers(`arto-propostas-${stamp}.csv`, 'text/csv; charset=utf-8') })
    }
    const active = activeScenarioId(ds)
    const units = buildCostUnits(ds, { activeScenario: active, includeMedicalEquipment: true })
    const byItem = new Map(units.flatMap((u) => u.itemCodes.map((c) => [c, u] as const)))
    const rows = ds.items.map((i) => {
      const u = byItem.get(i.code)
      return [i.code, i.group, i.categoryName, i.description, i.unit, i.quantity, i.unitPrice, referenceTotal(i), i.priceType, i.priceDate, i.source, i.status, i.scenario, isInScope(i, active) ? 'sim' : 'não', u?.estimate ?? null, u?.estimateSource ?? null, u && u.itemCodes.length > 1 ? u.key : null, i.edited.join(' ')]
    })
    return new NextResponse(
      toCsv(['codigo', 'grupo', 'macroetapa', 'descricao', 'unidade', 'quantidade', 'preco_unitario', 'total_referencia', 'tipo_preco', 'data_base', 'fonte', 'situacao', 'cenario', 'no_escopo', 'estimativa_atual', 'fonte_estimativa', 'grupo_sem_rateio', 'campos_editados'], rows),
      { headers: headers(`arto-pacotes-${stamp}.csv`, 'text/csv; charset=utf-8') },
    )
  }
  const db = getDb()
  const backup = {
    exportedAt: new Date().toISOString(),
    exportedBy: s.u,
    dataset: ds,
    overrides: db.prepare('SELECT * FROM overrides').all(),
    audit: db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  }
  return new NextResponse(JSON.stringify(backup, null, 2), { headers: headers(`arto-backup-${stamp}.json`, 'application/json') })
}
