import { expect, test } from '@playwright/test'
import { api, login, logout, registerOwner, seedStore, uniqueEmail } from './helpers'

test('staff can sell and read, but owner-only screens and APIs stay closed', async ({ page }) => {
  await registerOwner(page)
  const { ids, saleId } = await seedStore(page)

  const staffEmail = uniqueEmail('kasir')
  await page.goto('/settings/team')
  await page.getByLabel('Nama', { exact: true }).fill('Andi Kasir')
  await page.getByLabel('Email').fill(staffEmail)
  await page.getByLabel('Password awal').fill('kasir-rahasia-1')
  await page.getByRole('button', { name: 'Tambah staf' }).click()
  await expect(page.getByText(/ditambahkan sebagai staf/)).toBeVisible()
  await logout(page)

  await login(page, staffEmail, 'kasir-rahasia-1')
  const nav = page.getByRole('navigation', { name: 'Navigasi utama' })
  await expect(nav.getByRole('link', { name: /Kasir/ })).toBeVisible()
  await expect(nav.getByText('Administrasi')).toHaveCount(0)

  // UI: no write controls; owner URL explains instead of breaking.
  await page.goto('/products')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('link', { name: /Tambah produk/ })).toHaveCount(0)
  await page.goto('/settings/team')
  await expect(page.getByRole('heading', { name: 'Halaman khusus owner' })).toBeVisible()

  // API: the backend enforces it regardless of the UI.
  expect((await api(page, 'PATCH', `/products/${ids.kopi}`, { name: 'X' })).status).toBe(403)
  expect((await api(page, 'POST', `/sales/${saleId}/void`, { reason: 'coba' })).status).toBe(403)
  expect((await api(page, 'POST', '/inventory/restocks', { product_id: ids.kopi, quantity: '1' })).status).toBe(403)

  // Staff can still record a sale.
  await page.goto('/sales/new')
  await page.getByRole('button', { name: /^Masukkan Teh Melati/ }).click()
  await page.getByRole('button', { name: 'Simpan transaksi' }).click()
  await expect(page.getByText('Transaksi tersimpan')).toBeVisible()
})
