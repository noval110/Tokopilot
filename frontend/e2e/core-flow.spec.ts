import { expect, test } from '@playwright/test'
import { api, idr, registerOwner } from './helpers'

/**
 * PRD §16.1 mandatory E2E: register/login → setup store → create product →
 * restock → create sale → dashboard/report → AI question. Every number is
 * cross-checked against the API, the single source of truth.
 */
test('owner runs the whole MVP flow and every screen agrees on the numbers', async ({ page }) => {
  await registerOwner(page, 'Warung Bu Sari')

  // Create product through the form.
  await page.goto('/products')
  await expect(page.getByText('Katalog masih kosong')).toBeVisible()
  await page.getByRole('link', { name: /Tambah produk pertama/ }).click()
  await page.getByLabel('Nama produk').fill('Kopi Arabica Gayo 250g')
  await page.getByLabel(/^SKU/).fill('KOP-250')
  await page.getByLabel('Harga modal').fill('52000')
  await page.getByLabel('Harga jual').fill('68000')
  await page.getByLabel('Stok awal').fill('10')
  await page.getByLabel('Stok minimum').fill('5')
  await page.getByRole('button', { name: 'Simpan produk' }).click()
  await expect(page.getByText('Produk tersimpan.')).toBeVisible()
  const productId = page.url().split('/').pop() as string

  // Restock through the inventory form: 10 + 5 = 15.
  await page.goto(`/inventory/restock?product_id=${productId}`)
  await expect(page.getByText('Kopi Arabica Gayo 250g').first()).toBeVisible()
  await page.getByLabel('Jumlah').fill('5')
  await page.getByLabel('Catatan').fill('Kiriman supplier')
  await page.getByRole('button', { name: 'Catat restock' }).click()
  await expect(page.getByText('Tercatat di buku besar')).toBeVisible()
  expect((await api(page, 'GET', `/products/${productId}`)).body.current_stock).toBe('15.000')

  // Sell 2 at the cashier with a Rp 5.000 discount: 136.000 − 5.000 = 131.000.
  await page.goto('/sales/new')
  const tile = page.getByRole('button', { name: /^Masukkan Kopi Arabica/ })
  await tile.click()
  await tile.click()
  await page.getByLabel('Diskon transaksi').fill('5000')
  await expect(page.getByRole('form', { name: 'Nota transaksi' })).toContainText('131.000')
  await page.getByRole('button', { name: 'Simpan transaksi' }).click()
  await expect(page.getByText('Transaksi tersimpan')).toBeVisible()
  await expect(page.locator('article')).toContainText(/TP-\d{8}-0001/)
  expect((await api(page, 'GET', `/products/${productId}`)).body.current_stock).toBe('13.000')

  // Dashboard and report show the same net figure as the API.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const summary = (await api<{ sales: { net_sales: number; transaction_count: number } }>(page, 'GET', `/dashboard/summary?from=${today}&to=${today}`)).body
  expect(summary.sales).toMatchObject({ net_sales: 131000, transaction_count: 1 })
  await page.goto('/dashboard')
  await expect(page.getByText(idr(131000)).first()).toBeVisible()
  await page.goto('/reports')
  await expect(page.getByText(idr(131000)).first()).toBeVisible()

  // The assistant answers from the same data, with its source.
  await page.goto('/assistant')
  await page.getByRole('button', { name: 'Berapa penjualan hari ini?' }).click()
  const answer = page.locator('ol[aria-live] > li').last()
  await expect(answer).toContainText(`bersih ${idr(131000)} dari 1 transaksi`, { timeout: 20_000 })
  await expect(answer.getByRole('list', { name: 'Sumber data' })).toContainText('get_sales_summary')

  // And refuses to change anything.
  await page.getByLabel('Pertanyaan untuk asisten').fill('Ubah harga kopi jadi Rp 1.000')
  await page.getByRole('button', { name: 'Kirim' }).click()
  await expect(page.locator('ol[aria-live] > li').last()).toContainText('tidak dapat mengubah harga', { timeout: 20_000 })
  expect((await api(page, 'GET', `/products/${productId}`)).body.selling_price).toBe(68000)
})
