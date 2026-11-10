import { expect, test } from '@playwright/test'
import { api, idr, registerOwner } from './helpers'

/** Motion is decoration: content must never stay hidden, with or without animation. */
test('with animation on, every landing section appears once scrolled into view', async ({ page }) => {
  await page.goto('/')
  // The rolling shutter opens the shop once, then is gone (never blocks the page).
  await expect(page.locator('[data-shutter]')).toHaveCount(1)
  await expect(page.locator('[data-shutter]')).toHaveCount(0, { timeout: 3000 })
  await page.waitForLoadState('networkidle')
  await expect(page.locator('html')).toHaveClass(/reveal-armed/)
  const total = await page.locator('.reveal').count()
  expect(total).toBeGreaterThan(8)
  await page.evaluate(async () => {
    for (let y = 0; y <= document.documentElement.scrollHeight; y += 300) {
      window.scrollTo({ top: y, behavior: 'instant' })
      await new Promise((r) => setTimeout(r, 60))
    }
  })
  await expect(page.locator('.reveal:not(.is-visible)')).toHaveCount(0)
})

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('nothing is hidden and figures show their final value at once', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).not.toHaveClass(/reveal-armed/)
    await expect(page.locator('[data-shutter]')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Akurat dulu, pintar kemudian.' })).toBeVisible()

    await registerOwner(page)
    const prod = (await api<{ id: string }>(page, 'POST', '/products', { name: 'Teh', unit: 'pcs', cost_price: 1000, selling_price: 4500, initial_stock: '10', min_stock: '1' })).body
    await api(page, 'POST', '/sales', { idempotency_key: `motion-${Date.now()}`, items: [{ product_id: prod.id, quantity: '2' }], discount_amount: 0, payment_method: 'CASH' })
    await page.goto('/dashboard')
    // No count-up: the exact figure is in the hero immediately, not an intermediate number.
    await expect(page.getByText(idr(9000), { exact: true }).first()).toBeVisible({ timeout: 2000 })
  })
})
