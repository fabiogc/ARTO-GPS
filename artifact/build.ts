/**
 * Gera a página de teste (um único .html) com os dados do banco local embutidos.
 *   npx tsx artifact/build.ts --out /caminho/fora-do-repo/arto-teste.html
 * O arquivo gerado contém dados sensíveis: nunca salve dentro do repositório.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'esbuild'
import { defaultDbPath, openDb } from '../lib/db'
import { lastImportReport, loadDataset } from '../lib/repo'

const here = dirname(fileURLToPath(import.meta.url))
const outArg = process.argv.indexOf('--out')
if (outArg < 0) {
  console.error('Uso: npx tsx artifact/build.ts --out <arquivo.html fora do repositório>')
  process.exit(1)
}
const out = resolve(process.argv[outArg + 1])
if (out.startsWith(resolve(here, '..') + '/') && !out.includes('/data/private/')) {
  console.error('Recusado: o HTML contém dados sensíveis e não pode ficar dentro do repositório.')
  process.exit(1)
}

// React vem do CDN (UMD); os imports apontam para os globais.
const globals: Plugin = {
  name: 'react-globals',
  setup(b) {
    b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (a) => ({ path: a.path, namespace: 'g' }))
    b.onLoad({ filter: /.*/, namespace: 'g' }, (a) => {
      if (a.path === 'react/jsx-runtime' || a.path === 'react/jsx-dev-runtime')
        return { contents: 'const R=window.React;const j=(t,p,k)=>{const {children,...r}=p||{};return Array.isArray(children)?R.createElement(t,k===undefined?r:{...r,key:k},...children):R.createElement(t,k===undefined?r:{...r,key:k},children)};module.exports={jsx:j,jsxs:j,Fragment:R.Fragment}', loader: 'js' }
      return { contents: `module.exports = window.${a.path.startsWith('react-dom') ? 'ReactDOM' : 'React'}`, loader: 'js' }
    })
  },
}

const bundle = await build({
  entryPoints: [join(here, 'app.tsx')],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  target: ['safari15', 'chrome100'],
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  plugins: [globals],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})
const js = bundle.outputFiles[0].text

const db = openDb(defaultDbPath())
const ds = loadDataset(db)
const last = lastImportReport(db)
const snapshot = {
  dataset: ds,
  generatedAt: new Date().toISOString(),
  report: last && {
    at: last.at,
    divergences: last.report.divergences,
    alerts: last.report.alerts,
    quotesWithoutItem: last.report.coverage.quotesWithoutItem,
  },
}
const safeJson = JSON.stringify(snapshot).replace(/</g, '\\u003c')
const css = readFileSync(join(here, 'styles.css'), 'utf8')
const html = `<title>ARTO Obras · Hospital Caicó</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="robots" content="noindex, nofollow">
<style>${css}</style>
<div id="root"><p style="padding:24px 16px;color:var(--muted)">Carregando…</p></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>window.__ARTO_DATA__=${safeJson}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
`
writeFileSync(out, html, { mode: 0o600 })
console.log(`✔ ${out} (${(html.length / 1024).toFixed(0)} KB · ${ds.items.length} pacotes · ${ds.quotes.length} propostas)`)
