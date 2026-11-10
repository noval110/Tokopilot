import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ownerMe, staffMe } from '@/test/api'
import { categories, movement, page, product } from '@/test/fixtures'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const kopi = product()
const gula = product({ id: '22222222-2222-4222-8222-222222222222', name: 'Gula Aren', sku: 'GLA-500', unit: 'botol', current_stock: '2.000', min_stock: '10.000', stock_status: 'LOW' })
const summary = { active_products: 12, low_stock: 3, out_of_stock: 1 }

describe('InventoryPage', () => {
  it('shows real summary counts and the restock list for owners', async () => {
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /inventory/summary': () => ({ body: summary }),
      'GET /products': () => ({ body: page([gula]) }),
    })
    renderApp('/inventory')
    const tiles = await screen.findByLabelText('Ringkasan stok')
    await waitFor(() => expect(tiles).toHaveTextContent('12'))
    expect(tiles).toHaveTextContent('Stok rendah3')
    expect(tiles).toHaveTextContent('Habis1')

    await screen.findByText('Gula Aren')
    const hrefs = screen.getAllByRole('link', { name: /Restock/ }).map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('/inventory/restock') // header action
    expect(hrefs).toContain(`/inventory/restock?product_id=${gula.id}`) // row shortcut, prefilled
    const low = calls.find((c) => c.path === '/products')
    expect(low?.search.get('stock_status')).toBe('low')
    expect(low?.search.get('sort')).toBe('stock')
  })

  it('hides write actions from staff', async () => {
    mockApi({
      'GET /me': () => ({ body: staffMe }),
      'GET /inventory/summary': () => ({ body: summary }),
      'GET /products': () => ({ body: page([gula]) }),
    })
    renderApp('/inventory')
    await screen.findByText('Gula Aren')
    expect(screen.queryByRole('link', { name: /Restock/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Penyesuaian/ })).not.toBeInTheDocument()
  })

  it('renders the ledger with signed deltas, balances and reasons, and filters by type', async () => {
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /inventory/summary': () => ({ body: summary }),
      'GET /inventory/movements': () => ({
        body: page([
          movement({ id: 'm2', type: 'ADJUSTMENT_OUT', quantity_delta: '-3.000', stock_before: '24.000', stock_after: '21.000', reason_code: 'DAMAGED', note: 'Kemasan bocor' }),
          movement(),
        ]),
      }),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/inventory?tab=ledger')
    const table = await screen.findByRole('table', { name: /Buku besar/ })
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Koreksi keluar')
    expect(rows[1]).toHaveTextContent('−3 pcs')
    expect(rows[1]).toHaveTextContent('24 → 21')
    expect(rows[1]).toHaveTextContent('Rusak · Kemasan bocor')
    expect(rows[2]).toHaveTextContent('+20 pcs')
    expect(rows[2]).toHaveTextContent('10 Nov 2026')
    expect(rows[2]).toHaveTextContent('Sari Wulandari')

    await user.selectOptions(screen.getByLabelText('Jenis mutasi'), 'RESTOCK')
    await waitFor(() => expect(router.state.location.search).toContain('type=RESTOCK'))
    expect(calls.filter((c) => c.path === '/inventory/movements').at(-1)?.search.get('type')).toBe('RESTOCK')
  })

  it('shows an explicit empty state when everything is in stock', async () => {
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /inventory/summary': () => ({ body: { active_products: 2, low_stock: 0, out_of_stock: 0 } }),
      'GET /products': () => ({ body: page([], 0) }),
    })
    renderApp('/inventory')
    expect(await screen.findByText('Semua stok aman')).toBeInTheDocument()
  })
})

describe('Restock', () => {
  it('prefills the product, previews the new balance exactly and records the restock', async () => {
    let sent: unknown
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /products/:id': () => ({ body: kopi }),
      'POST /inventory/restocks': ({ body }) => {
        sent = body
        return { status: 201, body: { product: { ...kopi, current_stock: '44.000' }, movement: movement({ stock_before: '24.000', stock_after: '44.000' }) } }
      },
    })
    const user = userEvent.setup()
    renderApp(`/inventory/restock?product_id=${kopi.id}`)

    expect(await screen.findByText('Kopi Arabica 250g')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Jumlah (pcs)'), '20')
    const preview = screen.getByLabelText('Pratinjau perubahan stok')
    expect(preview).toHaveTextContent('24')
    expect(preview).toHaveTextContent('+20')
    expect(preview).toHaveTextContent('44')

    await user.type(screen.getByLabelText(/^Catatan/), 'Supplier Pak Budi')
    await user.click(screen.getByRole('button', { name: 'Catat restock' }))
    expect(await screen.findByText('Tercatat di buku besar')).toBeInTheDocument()
    expect(sent).toEqual({ product_id: kopi.id, quantity: '20', note: 'Supplier Pak Budi' })
  })

  it('rejects zero and fractional quantities for whole-unit products before calling the API', async () => {
    const { calls } = mockApi({ 'GET /me': () => ({ body: ownerMe }), 'GET /products/:id': () => ({ body: kopi }) })
    const user = userEvent.setup()
    renderApp(`/inventory/restock?product_id=${kopi.id}`)
    const qty = await screen.findByLabelText('Jumlah (pcs)')
    await user.type(qty, '0')
    await user.click(screen.getByRole('button', { name: 'Catat restock' }))
    expect(screen.getByText('Jumlah harus lebih dari 0.')).toBeInTheDocument()
    await user.clear(qty)
    await user.type(qty, '1,5')
    await user.click(screen.getByRole('button', { name: 'Catat restock' }))
    expect(screen.getByText('Jumlah harus bilangan bulat untuk satuan ini.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('picks a product with the keyboard', async () => {
    mockApi({ 'GET /me': () => ({ body: ownerMe }), 'GET /products': () => ({ body: page([kopi, gula]) }) })
    const user = userEvent.setup()
    renderApp('/inventory/restock')
    const box = await screen.findByRole('combobox', { name: 'Produk' })
    await user.type(box, 'g')
    await screen.findByRole('option', { name: /Gula Aren/ })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Gula Aren')).toBeInTheDocument()
    expect(screen.getByLabelText('Jumlah (botol)')).toBeInTheDocument()
  })
})

describe('Adjustment', () => {
  it('requires a reason, and a note for "Lainnya"', async () => {
    const { calls } = mockApi({ 'GET /me': () => ({ body: ownerMe }), 'GET /products/:id': () => ({ body: kopi }) })
    const user = userEvent.setup()
    renderApp(`/inventory/adjustments?product_id=${kopi.id}`)
    await user.type(await screen.findByLabelText('Jumlah (pcs)'), '2')
    await user.click(screen.getByRole('button', { name: 'Simpan penyesuaian' }))
    expect(screen.getByText('Pilih alasan penyesuaian.')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Lainnya/ }))
    await user.click(screen.getByRole('button', { name: 'Simpan penyesuaian' }))
    expect(screen.getByText('Jelaskan alasan pada catatan.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('warns in the preview and surfaces the server INSUFFICIENT_STOCK result', async () => {
    let sent: unknown
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /products/:id': () => ({ body: gula }),
      'POST /inventory/adjustments': ({ body }) => {
        sent = body
        return { status: 409, body: { error: { code: 'INSUFFICIENT_STOCK', message: 'Stok produk tidak mencukupi.', details: { available: '2.000', requested: '5.000' } } } }
      },
    })
    const user = userEvent.setup()
    renderApp(`/inventory/adjustments?product_id=${gula.id}`)
    await user.type(await screen.findByLabelText('Jumlah (botol)'), '5')
    expect(screen.getByLabelText('Pratinjau perubahan stok')).toHaveTextContent('−3')
    expect(screen.getByText(/Stok tidak cukup\. Tersedia 2 botol/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Rusak/ }))
    await user.click(screen.getByRole('button', { name: 'Simpan penyesuaian' }))
    expect(await screen.findByText('Stok tidak mencukupi')).toBeInTheDocument()
    expect(screen.getByText(/Tersedia 2 botol, diminta 5 botol/)).toBeInTheDocument()
    expect(sent).toEqual({ product_id: gula.id, direction: 'OUT', quantity: '5', reason_code: 'DAMAGED' })
  })
})

describe('Product page history', () => {
  it('shows the product ledger and inventory shortcuts for the owner', async () => {
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /categories': () => ({ body: categories }),
      'GET /products/:id': () => ({ body: kopi }),
      'GET /inventory/movements': ({ search }) => {
        expect(search.get('product_id')).toBe(kopi.id)
        return { body: page([movement({ type: 'INITIAL', quantity_delta: '24.000', stock_before: '0.000', stock_after: '24.000', note: null })]) }
      },
    })
    renderApp(`/products/${kopi.id}`)
    expect(await screen.findByRole('heading', { name: 'Riwayat stok' })).toBeInTheDocument()
    expect((await screen.findAllByText('Stok awal')).length).toBeGreaterThan(0)
    expect(screen.getByRole('table', { name: /Buku besar/ })).toHaveTextContent('0 → 24')
    expect(screen.getByRole('link', { name: /Sesuaikan/ })).toHaveAttribute('href', `/inventory/adjustments?product_id=${kopi.id}`)
  })
})
