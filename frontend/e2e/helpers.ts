import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'rahasia-toko-123'

let n = 0
export const uniqueEmail = (tag: string) => `${tag}+${Date.now()}-${n++}@e2e.tokopilot.test`

export const idr = (amount: number) => `Rp ${amount.toLocaleString('id-ID')}`

/** Registers through the real UI and creates the store. Lands on the dashboard. */
export async function registerOwner(page: Page, storeName = 'Warung Bu Sari') {
  const email = uniqueEmail('owner')
  await page.goto('/register')
  await page.getByLabel('Nama lengkap').fill('Sari Wulandari')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Buat akun' }).click()
  await expect(page).toHaveURL(/\/onboarding\/store$/)
  await page.getByLabel('Nama toko').fill(storeName)
  await page.getByRole('button', { name: 'Buat toko' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  return { email }
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Masuk' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

export async function logout(page: Page) {
  await page.getByRole('navigation', { name: 'Navigasi utama' }).locator('xpath=ancestor::aside').getByRole('button', { name: 'Keluar' }).click()
  await expect(page).toHaveURL(/\/login/)
}

interface ApiResult<T = Record<string, unknown>> {
  status: number
  body: T
}

/** Same-origin API call with the session cookie + CSRF header, exactly like the app. */
export async function api<T = Record<string, unknown>>(page: Page, method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const csrf = document.cookie.match(/tp_csrf=([^;]+)/)?.[1] ?? ''
      const r = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: r.status, body: await r.json().catch(() => null) }
    },
    { method, path, body },
  ) as Promise<ApiResult<T>>
}

/** A small synthetic catalogue with real sales, created through the API. */
export async function seedStore(page: Page) {
  const ids: Record<string, string> = {}
  const products = {
    kopi: { name: 'Kopi Arabica Gayo 250g', sku: 'KOP-250', unit: 'pcs', cost_price: 52000, selling_price: 68000, initial_stock: '40', min_stock: '5' },
    beras: { name: 'Beras Pandan Wangi', sku: 'BRS-01', unit: 'kg', unit_scale: 3, cost_price: 10000, selling_price: 12333, initial_stock: '50', min_stock: '5' },
    teh: { name: 'Teh Melati', sku: 'TEH-01', unit: 'pcs', cost_price: 3000, selling_price: 5000, initial_stock: '12', min_stock: '10' },
    gula: { name: 'Gula Aren Cair 500ml', sku: 'GLA-500', unit: 'botol', cost_price: 20000, selling_price: 32500, initial_stock: '3', min_stock: '6' },
  }
  for (const [key, body] of Object.entries(products)) {
    const r = await api<{ id: string }>(page, 'POST', '/products', body)
    expect(r.status, `create ${key}`).toBe(201)
    ids[key] = r.body.id
  }
  const stamp = Date.now()
  const sale = async (key: string, items: Array<[string, string]>, discount = 0, method = 'CASH') => {
    const r = await api<{ id: string }>(page, 'POST', '/sales', {
      idempotency_key: `seed-${key}-${stamp}`,
      items: items.map(([id, quantity]) => ({ product_id: id, quantity })),
      discount_amount: discount,
      payment_method: method,
    })
    expect(r.status, `sale ${key}`).toBe(201)
    return r.body.id
  }
  const s1 = await sale('s1', [[ids.kopi, '2'], [ids.beras, '1.5']], 5000)
  await sale('s2', [[ids.teh, '3']], 0, 'QRIS')
  await sale('s3', [[ids.kopi, '1'], [ids.gula, '1']], 500, 'TRANSFER')
  return { ids, saleId: s1 }
}

/** Fails when the page can be scrolled sideways (content wider than the viewport). */
export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed')
      .filter((el) => !el.closest('[data-overflow-ok], .overflow-x-auto, .overflow-auto, [role="dialog"]'))
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`)
    return { scroll: doc.scrollWidth, client: doc.clientWidth, wide }
  })
  expect(overflow.scroll, `${label}: page scrolls horizontally (${overflow.scroll} > ${overflow.client}); wide: ${overflow.wide.join(', ')}`).toBeLessThanOrEqual(overflow.client)
}
