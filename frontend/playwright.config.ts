import { defineConfig, devices } from '@playwright/test'

/**
 * Browser E2E against a running stack (Go API + AI service + Vite).
 * Start it with `scripts/dev-stack.ps1` (or the equivalent), then `pnpm e2e`.
 * Uses the installed Chrome — no browser download needed.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1, // one shared dev database; tests create their own stores
  retries: 0, // a flaky E2E is a bug to fix, not to retry
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    channel: 'chrome',
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } }],
})
