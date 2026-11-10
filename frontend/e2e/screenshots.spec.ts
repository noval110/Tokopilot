import { expect, test } from '@playwright/test'
import { login } from './helpers'

/**
 * README screenshots from the synthetic demo store (`api seed-demo`).
 * Runs only when DEMO_EMAIL / DEMO_PASSWORD are set:
 *   DEMO_EMAIL=… DEMO_PASSWORD=… pnpm e2e screenshots
 */
const email = process.env.DEMO_EMAIL
const password = process.env.DEMO_PASSWORD
const out = (name: string) => `../docs/screenshots/${name}.png`

test.skip(!email || !password, 'set DEMO_EMAIL and DEMO_PASSWORD to refresh README screenshots')
// Final state, not a frame mid-animation (count-up, growing bars).
test.use({ contextOptions: { reducedMotion: 'reduce' } })

test('README screenshots (desktop + mobile)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: out('landing') })

  await login(page, email as string, password as string)

  await page.goto('/dashboard?range=30d')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: out('dashboard') })

  await page.goto('/sales/new')
  await page.getByRole('button', { name: /^Masukkan Kopi Arabica/ }).click()
  await page.getByRole('button', { name: /^Masukkan Beras Pandan/ }).click()
  await page.getByRole('button', { name: /^Masukkan Susu UHT/ }).click()
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: out('cashier') })

  await page.goto('/reports?range=30d')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: out('reports') })

  await page.goto('/inventory?tab=ledger')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: out('ledger') })

  await page.goto('/assistant')
  await page.locator('section[aria-label="Percakapan"]').getByRole('button', { name: 'Bagaimana kondisi toko minggu ini?' }).click()
  await expect(page.locator('ol[aria-live] > li').last()).toContainText('Ringkasan toko', { timeout: 20_000 })
  await page.getByLabel('Pertanyaan untuk asisten').fill('Produk apa yang stoknya hampir habis?')
  await page.getByRole('button', { name: 'Kirim' }).click()
  await expect(page.locator('ol[aria-live] > li').last()).toContainText('stok', { timeout: 20_000 })
  await page.screenshot({ path: out('assistant') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: out('mobile-dashboard') })
  await page.goto('/sales/new')
  await page.getByRole('button', { name: /^Masukkan Teh Melati/ }).click()
  await page.screenshot({ path: out('mobile-cashier') })
})
