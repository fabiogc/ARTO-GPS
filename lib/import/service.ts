/**
 * Reimportação pelo app (admin): upload → simulação (dry-run) → aplicação.
 * Arquivos enviados ficam ao lado do banco, em `<pasta do banco>/uploads/<sha256>.xlsx` (fora do git).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultDbPath } from '../db'
import { getOrCreateDb } from '../repo'
import { applyImport, normalizeV4, reportToMarkdown, type ImportReport, type Resolution } from './import-v4'
import { parseV4 } from './parse-v4'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const uploadsDir = () => join(dirname(defaultDbPath()), 'uploads')
const isSha = (s: string) => /^[a-f0-9]{64}$/.test(s)

export function uploadPath(sha: string): string {
  if (!isSha(sha)) throw new Error('Identificador de arquivo inválido')
  return join(uploadsDir(), `${sha}.xlsx`)
}

/** Valida e grava o arquivo enviado. Retorna o SHA-256 (identificador estável). */
export function storeUpload(buf: Buffer, name: string): string {
  if (!/\.xlsx$/i.test(name)) throw new Error('Envie um arquivo .xlsx')
  if (buf.length === 0) throw new Error('Arquivo vazio')
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error('Arquivo maior que 10 MB')
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('O arquivo não é uma planilha .xlsx válida')
  const sha = createHash('sha256').update(buf).digest('hex')
  mkdirSync(uploadsDir(), { recursive: true })
  const p = uploadPath(sha)
  if (!existsSync(p)) writeFileSync(p, buf, { mode: 0o600 })
  return sha
}

async function normalized(sha: string, originalName?: string) {
  const p = uploadPath(sha)
  if (!existsSync(p)) throw new Error('Arquivo enviado não encontrado — envie novamente')
  const parsed = await parseV4(p)
  if (originalName) parsed.file = originalName
  return normalizeV4(parsed)
}

export interface Preview {
  report: ImportReport
  errors: string[]
  changes: number
}

/** Simula a importação sobre o banco atual sem alterar nada. */
export async function previewImport(sha: string, name?: string): Promise<Preview> {
  const n = await normalized(sha, name)
  const errors = n.report.issues.filter((i) => i.level === 'erro').map((i) => `${i.sheet ?? ''}: ${i.message}`)
  if (errors.length) return { report: n.report, errors, changes: 0 }
  const report = applyImport(getOrCreateDb(), n, { dryRun: true, resolution: 'ask', actor: 'simulação' })
  const changes = Object.values(report.sync ?? {}).reduce((a, s) => a + s.inserted + s.updated + s.removed, 0)
  return { report, errors, changes }
}

export async function commitImport(sha: string, resolution: Resolution, actor: string, name?: string): Promise<ImportReport> {
  const n = await normalized(sha, name)
  if (n.report.issues.some((i) => i.level === 'erro')) throw new Error('A planilha tem erros estruturais — importação bloqueada')
  const report = applyImport(getOrCreateDb(), n, { resolution, actor })
  const dir = dirname(defaultDbPath())
  writeFileSync(join(dir, 'import-report.json'), JSON.stringify(report, null, 2))
  writeFileSync(join(dir, 'import-report.md'), reportToMarkdown(report))
  return report
}
