import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, registerOwner, seedStore } from './helpers'

// Reduced motion: every scroll-revealed section is visible, so nothing escapes the audit.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

/** Sprint 7: every screen at 360 / 768 / 1440 — no sideways scrolling, screenshots for review. */
const WIDTHS = [360, 768, 1440] as const

test('every screen fits 360, 768 and 1440 px without horizontal scroll', async ({ page }) => {
  test.setTimeout(240_000)
  await registerOwner(page)
  const { ids, saleId } = await seedStore(page)
  const routes: Array<[string, string]> = [
    ['dashboard', '/dashboard'],
    ['products', '/products'],
    ['product-new', '/products/new'],
    ['product-detail', `/products/${ids.kopi}`],
    ['inventory', '/inventory'],
    ['ledger', '/inventory?tab=ledger'],
    ['restock', `/inventory/restock?product_id=${ids.kopi}`],
    ['adjustment', `/inventory/adjustments?product_id=${ids.gula}`],
    ['cashier', '/sales/new'],
    ['sales', '/sales'],
    ['receipt', `/sales/${saleId}`],
    ['reports', '/reports'],
    ['assistant', '/assistant'],
    ['settings-store', '/settings/store'],
    ['settings-team', '/settings/team'],
  ]
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 600 ? 800 : 900 })
    for (const [name, path] of routes) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expect(page.locator('h1').first()).toBeVisible()
      await expectNoHorizontalOverflow(page, `${name} @ ${width}px`)
      await page.screenshot({ path: `test-results/responsive/${width}-${name}.png`, fullPage: true })
    }
  }
})

test('public pages fit 360, 768 and 1440 px', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    for (const [name, path] of [['landing', '/'], ['login', '/login'], ['register', '/register']] as const) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expectNoHorizontalOverflow(page, `${name} @ ${width}px`)
      await page.screenshot({ path: `test-results/responsive/${width}-${name}.png`, fullPage: true })
    }
  }
})
