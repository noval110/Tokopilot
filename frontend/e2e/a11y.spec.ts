import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { registerOwner, seedStore } from './helpers'

// Reduced motion: every scroll-revealed section is visible, so nothing escapes the audit.
test.use({ contextOptions: { reducedMotion: 'reduce' } })

/** NFR-14: WCAG 2.1 AA via axe. Serious/critical violations fail; the rest are listed. */
async function audit(page: Page, label: string) {
  await page.waitForLoadState('networkidle')
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const describe = (vs: typeof violations) =>
    vs.map((v) => `${v.impact} ${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n')
  if (violations.length > blocking.length) console.log(`[a11y] ${label} (non-blocking):\n${describe(violations.filter((v) => !blocking.includes(v)))}`)
  expect(blocking, `${label}\n${describe(blocking)}`).toEqual([])
}

test('public pages have no serious accessibility violations', async ({ page }) => {
  for (const path of ['/', '/login', '/register']) {
    await page.goto(path)
    await audit(page, path)
  }
})

test('app screens have no serious accessibility violations', async ({ page }) => {
  test.setTimeout(120_000)
  await registerOwner(page)
  const { ids, saleId } = await seedStore(page)
  for (const path of [
    '/dashboard', '/products', '/products/new', `/products/${ids.kopi}`, '/inventory', '/inventory?tab=ledger',
    `/inventory/restock?product_id=${ids.kopi}`, '/sales/new', '/sales', `/sales/${saleId}`, '/reports',
    '/assistant', '/settings/store', '/settings/team',
  ]) {
    await page.goto(path)
    await audit(page, path)
  }
})
