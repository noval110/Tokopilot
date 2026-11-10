import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sale } from '@/services/sales'
import { mockApi, ownerMe, staffMe } from '@/test/api'
import { page, product } from '@/test/fixtures'
import { renderApp } from '@/test/render'

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.unstubAllGlobals())

const kopi = product()
const beras = product({ id: '33333333-3333-4333-8333-333333333333', name: 'Beras Pandan', sku: 'BRS-01', unit: 'kg', unit_scale: 3, selling_price: 12333, current_stock: '10.000' })
const habis = product({ id: '44444444-4444-4444-8444-444444444444', name: 'Teh Habis', sku: 'TEH-0', current_stock: '0.000', stock_status: 'OUT' })

function sale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    sale_number: 'TP-20261110-0042',
    status: 'COMPLETED',
    subtotal: 154500,
    discount_amount: 5000,
    net_total: 149500,
    payment_method: 'QRIS',
    notes: null,
    cashier: { id: 'u1', name: 'Sari Wulandari' },
    sold_at: '2026-11-10T02:12:00Z',
    item_count: 2,
    void: null,
    items: [
      { line_no: 1, product_id: kopi.id, product_name: kopi.name, sku: 'KOP-250', unit: 'pcs', unit_scale: 0, quantity: '2.000', unit_price: 68000, line_subtotal: 136000 },
      { line_no: 2, product_id: beras.id, product_name: 'Beras Pandan', sku: 'BRS-01', unit: 'kg', unit_scale: 3, quantity: '1.500', unit_price: 12333, line_subtotal: 18500 },
    ],
    ...overrides,
  }
}

const posRoutes = (checkout: Parameters<typeof mockApi>[0][string]) => ({
  'GET /me': () => ({ body: ownerMe }),
  'GET /products': ({ search }: { search: URLSearchParams }) => {
    const q = (search.get('q') ?? '').toLowerCase()
    const all = [kopi, beras, habis]
    return { body: page(q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q)) : all) }
  },
  'POST /sales': checkout,
  'GET /sales/:id': () => ({ body: sale() }),
})

describe('Kasir (checkout)', () => {
  it('builds a cart with exact totals and sends no prices to the server', async () => {
    let sent: Record<string, unknown> | undefined
    mockApi(posRoutes(({ body }) => { sent = body as Record<string, unknown>; return { status: 201, body: sale() } }))
    const user = userEvent.setup()
    const { router } = renderApp('/sales/new')

    await user.click(await screen.findByRole('button', { name: /Masukkan Kopi Arabica 250g/ }))
    await user.click(screen.getByRole('button', { name: /Masukkan Kopi Arabica 250g/ }))
    await user.click(screen.getByRole('button', { name: /Masukkan Beras Pandan/ }))
    const qty = screen.getByLabelText('Jumlah Beras Pandan')
    await user.clear(qty)
    await user.type(qty, '1,5')

    const nota = screen.getByRole('form', { name: 'Nota transaksi' })
    // 2 × 68.000 + round_half_up(1,5 × 12.333 = 18.499,5) = 136.000 + 18.500
    expect(nota).toHaveTextContent('Rp 154.500')
    await user.type(screen.getByLabelText('Diskon transaksi'), '5000')
    expect(within(nota).getByText('Rp 149.500')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /QRIS/ }))
    await user.click(screen.getByRole('button', { name: /Simpan transaksi · Rp 149.500/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/sales/${sale().id}`))
    expect(sent).toMatchObject({
      items: [{ product_id: kopi.id, quantity: '2' }, { product_id: beras.id, quantity: '1.5' }],
      discount_amount: 5000,
      payment_method: 'QRIS',
    })
    expect(String(sent?.['idempotency_key'])).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(sent)).not.toMatch(/price|subtotal/)
    expect(await screen.findByText('Transaksi tersimpan')).toBeInTheDocument()
  })

  it('reuses the idempotency key when retrying after a network failure', async () => {
    const keys: string[] = []
    let attempt = 0
    mockApi(posRoutes(({ body }) => {
      keys.push((body as { idempotency_key: string }).idempotency_key)
      attempt++
      if (attempt === 1) throw new TypeError('Failed to fetch')
      return { status: 201, body: sale() }
    }))
    const user = userEvent.setup()
    renderApp('/sales/new')
    await user.click(await screen.findByRole('button', { name: /Masukkan Kopi Arabica 250g/ }))
    await user.click(screen.getByRole('button', { name: /Simpan transaksi/ }))
    expect(await screen.findByText(/transaksi tidak akan tercatat dua kali/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Simpan transaksi/ }))
    await screen.findByText('Transaksi tersimpan')
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('marks short lines from INSUFFICIENT_STOCK and stays on the cashier screen', async () => {
    const { calls } = mockApi(posRoutes(() => ({
      status: 409,
      body: { error: { code: 'INSUFFICIENT_STOCK', message: 'Stok produk tidak mencukupi.', details: { items: [{ product_id: kopi.id, available: '1.000', requested: '2.000' }] } } },
    })))
    const user = userEvent.setup()
    const { router } = renderApp('/sales/new')
    await user.click(await screen.findByRole('button', { name: /Masukkan Kopi Arabica 250g/ }))
    await user.click(screen.getByRole('button', { name: /Masukkan Kopi Arabica 250g/ }))
    await user.click(screen.getByRole('button', { name: /Simpan transaksi/ }))
    expect(await screen.findByText('Stok tidak cukup. Tersedia 1 pcs.')).toBeInTheDocument()
    expect(screen.getByLabelText('Jumlah Kopi Arabica 250g')).toHaveAttribute('aria-invalid', 'true')
    expect(router.state.location.pathname).toBe('/sales/new')
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('adds a product by exact SKU + Enter (barcode scanner flow) and disables sold-out items', async () => {
    mockApi(posRoutes(() => ({ status: 201, body: sale() })))
    const user = userEvent.setup()
    renderApp('/sales/new')
    expect(await screen.findByRole('button', { name: /^Masukkan Teh Habis.*Habis/ })).toBeDisabled()
    await user.type(screen.getByLabelText('Cari produk atau pindai SKU'), 'brs-01{Enter}')
    expect(await screen.findByLabelText('Jumlah Beras Pandan')).toHaveValue('1')
    expect(screen.getByLabelText('Cari produk atau pindai SKU')).toHaveValue('')
  })

  it('blocks a discount larger than the subtotal', async () => {
    const { calls } = mockApi(posRoutes(() => ({ status: 201, body: sale() })))
    const user = userEvent.setup()
    renderApp('/sales/new')
    await user.click(await screen.findByRole('button', { name: /Masukkan Kopi Arabica 250g/ }))
    await user.type(screen.getByLabelText('Diskon transaksi'), '70000')
    expect(screen.getByText('Diskon melebihi subtotal.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Simpan transaksi/ }))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})

describe('Riwayat transaksi', () => {
  it('lists receipts with status stamps and filters by status', async () => {
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /sales': () => ({ body: page([sale(), sale({ id: 'v1', sale_number: 'TP-20261110-0041', status: 'VOIDED' })]) }),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/sales')
    const table = await screen.findByRole('table')
    expect(table).toHaveTextContent('TP-20261110-0042')
    expect(within(table).getAllByText(/Lunas|Void/)).toHaveLength(2)
    await user.selectOptions(screen.getByLabelText('Status'), 'VOIDED')
    await waitFor(() => expect(router.state.location.search).toContain('status=VOIDED'))
    expect(calls.filter((c) => c.path === '/sales').at(-1)?.search.get('status')).toBe('VOIDED')
  })
})

describe('Detail nota', () => {
  it('lets the owner void with a mandatory reason', async () => {
    let reason: unknown
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /sales/:id': () => ({ body: sale() }),
      'POST /sales/:id/void': ({ body }) => {
        reason = (body as { reason: string }).reason
        return { body: sale({ status: 'VOIDED', void: { reason: 'Salah input jumlah', by: { id: 'u1', name: 'Sari Wulandari' }, at: '2026-11-10T03:00:00Z' } }) }
      },
    })
    const user = userEvent.setup()
    renderApp(`/sales/${sale().id}`)
    const receipt = await screen.findByRole('article', { name: /Nota TP-20261110-0042/ })
    expect(receipt).toHaveTextContent('1,5 kg × 12.333')
    expect(receipt).toHaveTextContent('Rp 149.500')

    await user.click(screen.getByRole('button', { name: 'Void' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /Void transaksi/ }))
    expect(within(dialog).getByText('Alasan pembatalan wajib (minimal 3 karakter).')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Alasan pembatalan'), 'Salah input jumlah')
    await user.click(within(dialog).getByRole('button', { name: /Void transaksi/ }))

    expect(await screen.findByText(/Dibatalkan oleh Sari Wulandari/)).toBeInTheDocument()
    expect(reason).toBe('Salah input jumlah')
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
  })

  it('hides void from staff', async () => {
    mockApi({ 'GET /me': () => ({ body: staffMe }), 'GET /sales/:id': () => ({ body: sale() }) })
    renderApp(`/sales/${sale().id}`)
    await screen.findByRole('article')
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument()
  })
})
