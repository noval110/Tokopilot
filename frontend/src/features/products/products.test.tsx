import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, ownerMe, staffMe } from '@/test/api'
import { categories, page, product } from '@/test/fixtures'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const gula = product({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Gula Aren Cair 500ml',
  sku: 'GLA-500',
  unit: 'botol',
  current_stock: '2.000',
  min_stock: '10.000',
  stock_status: 'LOW',
})

describe('ProductsPage', () => {
  it('lists products with rupiah prices, stock and text status badges', async () => {
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /products': () => ({ body: page([product(), gula]) }),
      'GET /categories': () => ({ body: categories }),
    })
    renderApp('/products')
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Kopi Arabica 250g')
    expect(rows[1]).toHaveTextContent('Rp 68.000')
    expect(rows[1]).toHaveTextContent('24 pcs')
    expect(rows[1]).toHaveTextContent('Aman')
    expect(rows[2]).toHaveTextContent('Stok rendah')
    expect(screen.getByText('1–2 dari 2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tambah produk/ })).toBeInTheDocument()
  })

  it('hides write actions from staff', async () => {
    mockApi({
      'GET /me': () => ({ body: staffMe }),
      'GET /products': () => ({ body: page([product()]) }),
      'GET /categories': () => ({ body: categories }),
    })
    renderApp('/products')
    await screen.findByRole('table')
    expect(screen.queryByRole('link', { name: /Tambah produk/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Kategori/ })).not.toBeInTheDocument()
  })

  it('sends search and stock filters to the API and keeps them in the URL', async () => {
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /products': () => ({ body: page([gula]) }),
      'GET /categories': () => ({ body: categories }),
    })
    const user = userEvent.setup()
    const { router } = renderApp('/products')
    await screen.findByRole('table')

    await user.type(screen.getByLabelText('Cari nama atau SKU'), 'gula')
    await waitFor(() => expect(router.state.location.search).toContain('q=gula'), { timeout: 3000 })
    await user.click(screen.getByRole('radio', { name: 'Stok rendah' }))
    await waitFor(() => expect(router.state.location.search).toContain('stock_status=low'), { timeout: 3000 })

    const last = calls.filter((c) => c.path === '/products').at(-1)
    expect(last?.search.get('q')).toBe('gula')
    expect(last?.search.get('stock_status')).toBe('low')
    expect(last?.search.get('per_page')).toBe('20')
  })

  it('distinguishes an empty catalog from an empty filter result', async () => {
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /products': () => ({ body: page([], 0) }),
      'GET /categories': () => ({ body: categories }),
    })
    renderApp('/products')
    expect(await screen.findByText('Katalog masih kosong')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tambah produk pertama/ })).toHaveAttribute('href', '/products/new')

    vi.unstubAllGlobals()
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /products': () => ({ body: page([], 0) }),
      'GET /categories': () => ({ body: categories }),
    })
    renderApp('/products?q=zzz')
    expect(await screen.findByText('Tidak ada produk yang cocok')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hapus semua filter' })).toBeInTheDocument()
  })
})

describe('NewProductPage', () => {
  const routes = (onCreate?: (body: unknown) => { status?: number; body?: unknown }) => ({
    'GET /me': () => ({ body: ownerMe }),
    'GET /categories': () => ({ body: categories }),
    'POST /products': ({ body }: { body: unknown }) => onCreate?.(body) ?? { status: 201, body: product() },
    'GET /products/:id': () => ({ body: product() }),
  })

  it('validates required fields and unit precision before calling the API', async () => {
    const { calls } = mockApi(routes())
    const user = userEvent.setup()
    renderApp('/products/new')
    await user.type(await screen.findByLabelText('Stok awal'), '2,5')
    await user.click(screen.getByRole('button', { name: 'Simpan produk' }))

    expect(screen.getByText('Nama produk wajib diisi.')).toBeInTheDocument()
    expect(screen.getByText('Harga modal wajib diisi.')).toBeInTheDocument()
    expect(screen.getByText('Harga jual wajib diisi.')).toBeInTheDocument()
    expect(screen.getByText('Stok awal harus bilangan bulat untuk satuan ini.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('creates a product with integer prices, canonical quantities and live previews', async () => {
    let sent: Record<string, unknown> | undefined
    mockApi(routes((body) => { sent = body as Record<string, unknown>; return { status: 201, body: product() } }))
    const user = userEvent.setup()
    const { router } = renderApp('/products/new')

    await user.type(await screen.findByLabelText('Nama produk'), 'Beras Pandan')
    await user.type(screen.getByLabelText(/^SKU/), ' brs-05 ')
    const unit = screen.getByLabelText('Satuan')
    await user.clear(unit)
    await user.type(unit, 'kg')
    expect(screen.getByLabelText('Desimal kuantitas')).toHaveValue('3') // preset for kg

    await user.type(screen.getByLabelText('Harga modal'), '12333')
    await user.type(screen.getByLabelText('Harga jual'), '15000')
    expect(screen.getByLabelText('Harga jual')).toHaveValue('15.000')
    expect(screen.getByText('Margin per satuan')).toBeInTheDocument()

    const tag = screen.getByLabelText('Pratinjau label rak')
    expect(tag).toHaveTextContent('Beras Pandan')
    expect(tag).toHaveTextContent('15.000')
    expect(tag).toHaveTextContent('/kg')

    await user.type(screen.getByLabelText('Stok awal'), '12,125')
    await user.type(screen.getByLabelText('Stok minimum'), '2,5')
    await user.click(screen.getByRole('button', { name: 'Simpan produk' }))

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/products\/[0-9a-f-]+$/))
    expect(sent).toEqual({
      name: 'Beras Pandan', sku: 'brs-05', category_id: '', unit: 'kg', unit_scale: 3,
      cost_price: 12333, selling_price: 15000, min_stock: '2.5', initial_stock: '12.125',
    })
  })

  it('warns when the selling price is below cost', async () => {
    mockApi(routes())
    const user = userEvent.setup()
    renderApp('/products/new')
    await user.type(await screen.findByLabelText('Harga modal'), '10000')
    await user.type(screen.getByLabelText('Harga jual'), '8000')
    expect(screen.getByText('Harga jual di bawah modal')).toBeInTheDocument()
  })

  it('maps DUPLICATE_SKU to the SKU field and clears it on edit', async () => {
    mockApi(routes(() => ({
      status: 409,
      body: { error: { code: 'DUPLICATE_SKU', message: 'SKU sudah dipakai produk aktif lain.', details: { fields: { sku: 'SKU sudah dipakai produk aktif lain. Gunakan kode lain.' } } } },
    })))
    const user = userEvent.setup()
    renderApp('/products/new')
    await user.type(await screen.findByLabelText('Nama produk'), 'Kopi')
    await user.type(screen.getByLabelText(/^SKU/), 'KOP-250')
    await user.type(screen.getByLabelText('Harga modal'), '1')
    await user.type(screen.getByLabelText('Harga jual'), '2')
    await user.click(screen.getByRole('button', { name: 'Simpan produk' }))
    expect(await screen.findByText('SKU sudah dipakai produk aktif lain. Gunakan kode lain.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^SKU/), 'B')
    expect(screen.queryByText('SKU sudah dipakai produk aktif lain. Gunakan kode lain.')).not.toBeInTheDocument()
  })
})

describe('ProductDetailPage', () => {
  it('lets the owner edit without exposing stock as an editable field', async () => {
    let patch: Record<string, unknown> | undefined
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /categories': () => ({ body: categories }),
      'GET /products/:id': () => ({ body: product() }),
      'PATCH /products/:id': ({ body }) => { patch = body as Record<string, unknown>; return { body: product({ selling_price: 70000 }) } },
    })
    const user = userEvent.setup()
    renderApp(`/products/${product().id}`)

    expect(await screen.findByText('Stok saat ini')).toBeInTheDocument()
    expect(screen.queryByLabelText('Stok awal')).not.toBeInTheDocument()
    const price = screen.getByLabelText('Harga jual')
    await user.clear(price)
    await user.type(price, '70000')
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }))

    expect(await screen.findByText('Produk tersimpan.')).toBeInTheDocument()
    expect(patch).toMatchObject({ selling_price: 70000, min_stock: '5' })
    expect(patch).not.toHaveProperty('current_stock')
    expect(patch).not.toHaveProperty('initial_stock')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Detail produk')
  })

  it('archives only after confirmation, then becomes read-only', async () => {
    const { calls } = mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /categories': () => ({ body: categories }),
      'GET /products/:id': () => ({ body: product() }),
      'POST /products/:id/archive': () => ({ body: product({ is_active: false, archived_at: '2026-11-10T03:00:00Z' }) }),
    })
    const user = userEvent.setup()
    renderApp(`/products/${product().id}`)

    await user.click(await screen.findByRole('button', { name: 'Arsipkan' }))
    const dialog = screen.getByRole('alertdialog', { name: /Arsipkan Kopi Arabica/ })
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(calls.some((c) => c.path.endsWith('/archive'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Arsipkan' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Arsipkan produk/ }))

    expect(await screen.findByText('Produk diarsipkan')).toBeInTheDocument()
    expect(screen.getByText('Arsip')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Simpan perubahan' })).not.toBeInTheDocument()
  })

  it('shows staff a read-only view', async () => {
    mockApi({ 'GET /me': () => ({ body: staffMe }), 'GET /products/:id': () => ({ body: product() }) })
    renderApp(`/products/${product().id}`)
    expect(await screen.findByText('Harga modal')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arsipkan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Simpan perubahan' })).not.toBeInTheDocument()
  })

  it('shows not-found for another store’s product id', async () => {
    mockApi({
      'GET /me': () => ({ body: ownerMe }),
      'GET /categories': () => ({ body: categories }),
      'GET /products/:id': () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Produk tidak ditemukan.' } } }),
    })
    renderApp('/products/33333333-3333-4333-8333-333333333333')
    expect(await screen.findByRole('heading', { name: 'Produk tidak ditemukan' })).toBeInTheDocument()
  })
})
