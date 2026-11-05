import { expect, test, type Page } from '@playwright/test'
import { E2E } from '../../playwright.config'

async function login(page: Page, user = E2E.admin, pw = E2E.adminPw) {
  await page.goto('/login')
  await page.getByTestId('login-user').fill(user)
  await page.getByTestId('login-password').fill(pw)
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('role-badge')).toBeVisible()
}

/** Nenhuma tela pode ter rolagem horizontal no iPhone. */
async function expectNoHorizontalScroll(page: Page) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(w, `largura ${w}px em ${page.url()}`).toBeLessThanOrEqual(390)
}

let consoleErrors: string[] = []
test.beforeEach(({ page }) => {
  consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
})
test.afterEach(() => {
  expect(consoleErrors, 'erros no console').toEqual([])
})

test('acesso exige login; senha errada mostra erro', async ({ page }) => {
  await page.goto('/custos')
  await expect(page).toHaveURL(/\/login\?next=%2Fcustos/)
  await page.getByTestId('login-user').fill(E2E.admin)
  await page.getByTestId('login-password').fill('senha-errada')
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('login-error')).toContainText('incorretos')
  const res = await page.request.get('/api/export')
  expect(res.status()).toBe(401)
})

test('visão geral: KPIs, cobertura e navegação inferior', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('heading', { name: 'Hospital Caicó' })).toBeVisible()
  await expect(page.getByTestId('coverage-banner')).toContainText('Orçamento em desenvolvimento — cobertura')
  for (const id of ['kpi-known', 'kpi-contracted', 'kpi-paid', 'kpi-unpriced']) await expect(page.getByTestId(id)).toBeVisible()
  // Sem contratos na V4: contratado não pode aparecer como R$ 0,00
  await expect(page.getByTestId('kpi-contracted')).not.toContainText('R$ 0,00')
  await expectNoHorizontalScroll(page)
  for (const [tab, url, heading] of [
    ['tab-custos', /\/custos$/, 'Custos'],
    ['tab-abc', /\/abc$/, 'Curva ABC'],
    ['tab-propostas', /\/propostas$/, 'Propostas'],
    ['tab-mais', /\/mais$/, 'Mais'],
    ['tab-inicio', /\/$/, 'Hospital Caicó'],
  ] as const) {
    await page.getByTestId(tab).tap()
    await expect(page).toHaveURL(url)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expect(page.getByTestId(tab)).toHaveAttribute('aria-current', 'page')
    await expectNoHorizontalScroll(page)
  }
})

test('custos: abrir categoria, abrir item, voltar e filtrar', async ({ page }) => {
  await login(page)
  await page.getByTestId('tab-custos').tap()
  await expect(page.getByTestId('category-list').locator('li')).toHaveCount(22)
  await expect(page.getByTestId('costs-total')).toBeVisible()

  await page.getByTestId('category-01').tap()
  await expect(page).toHaveURL(/\/custos\/01$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Viabilidade e projetos')
  await expect(page.getByTestId('category-total')).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.getByTestId('item-01.011').tap()
  await expect(page).toHaveURL(/\/itens\/01\.011$/)
  await expect(page.getByTestId('item-estimate')).toBeVisible()
  // Item sem preço de referência mostra “Não precificado”, nunca zero
  await expect(page.getByText('Não precificado').first()).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.getByTestId('back-button').tap()
  await expect(page).toHaveURL(/\/custos\/01$/)
  await page.getByTestId('back-button').tap()
  await expect(page).toHaveURL(/\/custos$/)

  // Filtros e ordenação
  await page.getByTestId('filter-com-valor').tap()
  await expect(page).toHaveURL(/filtro=com-valor/)
  const withValue = await page.getByTestId('category-list').locator('li').count()
  expect(withValue).toBeGreaterThan(0)
  expect(withValue).toBeLessThan(22)
  await expect(page.getByTestId('filter-com-valor')).toHaveAttribute('aria-current', 'true')
  await page.getByTestId('filter-todas').tap()
  await page.getByTestId('sort-valor').tap()
  await expect(page).toHaveURL(/ordem=valor/)
  await expect(page.getByTestId('category-list').locator('li').first()).not.toContainText('Não precificado')

  // Filtro de itens dentro da categoria
  await page.goto('/custos/01')
  await page.getByTestId('item-filter-sem-valor').tap()
  await expect(page).toHaveURL(/filtro=sem-valor/)
  await expect(page.getByTestId('item-list').locator('li').first()).toBeVisible()
  await page.getByTestId('item-filter-com-valor').tap()
  await expect(page.getByTestId('item-list')).not.toContainText('Não precificado')
})

test('voltar em link direto usa o destino lógico', async ({ page }) => {
  await login(page)
  await page.goto('/itens/06.004')
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await page.getByTestId('back-button').tap()
  await expect(page).toHaveURL(/\/custos\/06$/)
})

test('busca global por serviço, código e fornecedor', async ({ page }) => {
  await login(page)
  await page.goto('/mais')
  await page.getByTestId('more-busca').tap()
  await page.getByTestId('search-input').fill('gases')
  await page.getByTestId('search-submit').tap()
  await expect(page).toHaveURL(/\/busca\?q=gases/)
  await expect(page.getByTestId('search-results')).toBeVisible()
  await page.getByTestId('result-item-13.001').tap()
  await expect(page).toHaveURL(/\/itens\/13\.001$/)
  await page.getByTestId('back-button').tap()
  await expect(page).toHaveURL(/\/busca\?q=gases/)

  await page.getByTestId('search-input').fill('06.004')
  await page.getByTestId('search-input').press('Enter')
  await expect(page.getByTestId('result-item-06.004')).toBeVisible()

  // Fornecedor: usa o nome da 1ª proposta (sem fixar dados sensíveis no teste)
  await page.goto('/propostas')
  const supplier = (await page.getByTestId('quote-list').locator('li').first().locator('span').first().textContent())!.trim()
  await page.goto(`/busca?q=${encodeURIComponent(supplier.split(' ')[0])}`)
  await expect(page.locator('[data-testid^="result-quote-"]').first()).toBeVisible()

  await page.goto('/busca?q=zzzz-inexistente')
  await expect(page.getByTestId('empty-state')).toContainText('Nada encontrado')
})

test('curva ABC: alternar base e agrupamento', async ({ page }) => {
  await login(page)
  await page.getByTestId('tab-abc').tap()
  await expect(page.getByTestId('abc-banner')).toContainText('Denominador')
  await expect(page.getByTestId('abc-table').locator('li').first()).toBeVisible()
  await expect(page.getByTestId('abc-chart')).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.getByTestId('abc-mode-categorias').tap()
  await expect(page).toHaveURL(/por=categorias/)
  await expect(page.getByTestId('abc-mode-categorias')).toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('abc-table')).toContainText('Viabilidade e projetos')

  await page.getByTestId('abc-base-referencia').tap()
  await expect(page).toHaveURL(/base=referencia/)
  // V4 não tem nenhum preço de referência: estado vazio explicativo
  await expect(page.getByTestId('empty-state')).toContainText('Nenhum pacote tem quantidade × preço')
  await page.getByTestId('empty-state').getByRole('link', { name: 'Ver estimativa atual' }).tap()
  await expect(page).toHaveURL(/base=estimativa/)
  await page.getByTestId('abc-mode-itens').tap()
  await page.getByTestId('abc-table').locator('a').first().tap()
  await expect(page).toHaveURL(/\/itens\//)
})

test('propostas: filtrar, abrir, ver vínculo e voltar', async ({ page }) => {
  await login(page)
  await page.getByTestId('tab-propostas').tap()
  await expect(page).toHaveURL(/\/propostas$/)
  await expect(page.getByTestId('quote-list').locator('li').first()).toBeVisible()
  const total = await page.getByTestId('quote-list').locator('li').count()
  expect(total).toBeGreaterThan(0)
  await page.getByTestId('quote-filter-solicitada').tap()
  await expect(page).toHaveURL(/status=solicitada/)
  await expect(page.getByTestId('quote-filter-solicitada')).toHaveAttribute('aria-current', 'true')
  expect(await page.getByTestId('quote-list').locator('li').count()).toBeLessThan(total)
  await page.getByTestId('quote-filter-todas').tap()

  await page.getByTestId('quote-list').locator('a').first().tap()
  await expect(page).toHaveURL(/\/propostas\/.+/)
  await expect(page.getByTestId('quote-amount')).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.getByTestId('back-button').tap()
  await expect(page).toHaveURL(/\/propostas$/)

  // Tarifa diária é rotulada como “/ dia” e não entra em totais
  const daily = page.getByTestId('quote-list').locator('li', { hasText: '/ dia' })
  await expect(daily).toContainText('Tarifa unitária')
  await expect(page.getByTestId('quote-list')).toContainText('Informado verbalmente')
})

test('admin: lançar preço de referência atualiza totais e histórico', async ({ page }) => {
  await login(page)
  await page.goto('/')
  const before = await page.getByTestId('kpi-unpriced').locator('.num').textContent()
  await page.goto('/itens/02.001')
  await page.getByTestId('item-edit').locator('summary').tap()
  await page.locator('input[name=quantity]').fill('1')
  await page.locator('input[name=unitPrice]').fill('1.234,56')
  await page.locator('select[name=priceType]').selectOption('estimativa')
  await page.locator('input[name=source]').fill('Teste E2E — valor fictício')
  await page.getByRole('button', { name: 'Salvar' }).tap()
  await expect(page.getByTestId('flash')).toContainText('atualizado')
  await expect(page.getByTestId('item-estimate')).toContainText('R$ 1.234,56')
  await expect(page.getByTestId('item-history')).toContainText('unitPrice')
  await page.goto('/')
  const after = await page.getByTestId('kpi-unpriced').locator('.num').textContent()
  expect(Number(after)).toBe(Number(before) - 1)
  // Preço sem tipo é recusado
  await page.goto('/itens/02.002')
  await page.getByTestId('item-edit').locator('summary').tap()
  await page.locator('input[name=quantity]').fill('1')
  await page.locator('input[name=unitPrice]').fill('10')
  await page.getByRole('button', { name: 'Salvar' }).tap()
  await expect(page.getByTestId('flash')).toContainText('tipo do preço')
})

test('admin: cenário estrutural ativo é exclusivo', async ({ page }) => {
  await login(page)
  await page.goto('/cenarios')
  await page.locator('#scenario-select').selectOption('metalica')
  await page.getByTestId('scenario-form').getByRole('button', { name: 'Aplicar' }).tap()
  await expect(page.getByTestId('flash')).toContainText('Cenário estrutural ativo atualizado')
  await expect(page.getByTestId('scenario-list').getByText('Ativo', { exact: true })).toHaveCount(1)
  await page.goto('/custos/06')
  await expect(page.getByTestId('item-06.003')).not.toContainText('Fora do cenário')
  await expect(page.getByTestId('item-06.004')).toContainText('Fora do cenário')
  await page.goto('/cenarios')
  await page.locator('#scenario-select').selectOption('nenhum')
  await page.getByTestId('scenario-form').getByRole('button', { name: 'Aplicar' }).tap()
  await expect(page.getByTestId('scenario-list').getByText('Ativo', { exact: true })).toHaveCount(0)
})

test('pendências: abas e filtros de risco', async ({ page }) => {
  await login(page)
  await page.goto('/mais')
  await page.getByTestId('more-pendencias').tap()
  await expect(page.getByTestId('pendencias-list').locator('li').first()).toContainText('Risco alto')
  await page.getByTestId('tab-sem-cotacao').tap()
  await expect(page).toHaveURL(/aba=sem-cotacao/)
  await page.getByTestId('risk-alto').tap()
  await expect(page.getByTestId('noquote-list')).not.toContainText('Risco baixo')
  await page.getByTestId('risk-todos').tap()
  await page.getByTestId('load-more').tap()
  await expect(page).toHaveURL(/limite=/)
})

test('cliente: visão resumida sem propostas nem exportação', async ({ page }) => {
  await login(page, E2E.client, E2E.clientPw)
  await expect(page.getByTestId('role-badge')).toHaveText('Visão do cliente')
  await expect(page.getByTestId('tab-propostas')).toHaveCount(0)
  await expect(page.getByTestId('tab-pendencias')).toBeVisible()
  await page.goto('/propostas')
  await expect(page).toHaveURL(/\/\?negado=1/)
  await expect(page.getByTestId('flash')).toContainText('restrito')
  expect((await page.request.get('/api/export')).status()).toBe(403)
  await page.goto('/itens/01.011')
  await expect(page.getByTestId('item-quotes')).toHaveCount(0)
  await page.goto('/mais')
  await page.getByTestId('logout').tap()
  await expect(page).toHaveURL(/\/login/)
})

test('admin: exportação CSV e JSON', async ({ page }) => {
  await login(page)
  const csv = await page.request.get('/api/export?formato=csv')
  expect(csv.status()).toBe(200)
  const text = await csv.text()
  expect(text.split('\r\n')).toHaveLength(198)
  expect(text).toContain('codigo;grupo;macroetapa')
  const json = await (await page.request.get('/api/export?formato=json')).json()
  expect(json.dataset.items).toHaveLength(197)
})

test('admin: reimportação pelo app simula antes de aplicar', async ({ page }) => {
  await login(page)
  await page.goto('/mais')
  await page.getByTestId('more-importar').tap()
  await expect(page.getByTestId('upload-form')).toBeVisible()
  // Arquivo inválido é recusado
  await page.getByTestId('upload-input').setInputFiles({ name: 'falso.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('não é planilha') })
  await page.getByTestId('upload-submit').tap()
  await expect(page.getByTestId('flash')).toContainText('não é uma planilha')
  // Mesma V4 já importada → simulação sem mudanças, botão desabilitado
  await page.getByTestId('upload-input').setInputFiles(process.env.V4_XLSX_PATH || 'data/private/ARTO_Caico_Orcamento_V4_Quantificacao_Integral.xlsx')
  await page.getByTestId('upload-submit').tap()
  await expect(page.getByTestId('import-preview')).toContainText('197')
  await expect(page.getByTestId('no-changes')).toBeVisible()
  await expect(page.getByTestId('apply-submit')).toBeDisabled()
})
