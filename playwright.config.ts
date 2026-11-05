import { defineConfig } from '@playwright/test'
import { hashPassword } from './lib/auth-core'

/**
 * E2E em viewport de iPhone (390×844, toque). Usa um banco próprio (tests/e2e/.tmp/e2e.db),
 * recriado a cada execução, e credenciais de teste geradas aqui — nunca as reais.
 * Pré-requisito: `npm run build`.
 */
export const E2E = { admin: 'admin', adminPw: 'e2e-admin-senha-teste', client: 'cliente', clientPw: 'e2e-cliente-senha-teste', port: 3200 }

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${E2E.port}`,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'pt-BR',
    timezoneId: 'America/Fortaleza',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run e2e:server',
    url: `http://localhost:${E2E.port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SESSION_SECRET: 'e2e-session-secret-0123456789-abcdefghijklmnop',
      ADMIN_USERNAME: E2E.admin,
      ADMIN_PASSWORD_HASH: hashPassword(E2E.adminPw),
      CLIENT_USERNAME: E2E.client,
      CLIENT_PASSWORD_HASH: hashPassword(E2E.clientPw),
      DATABASE_PATH: 'tests/e2e/.tmp/e2e.db',
      NODE_NO_WARNINGS: '1',
    },
  },
})
