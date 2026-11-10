import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storeToday } from '@/lib/format'
import { addDays, presetRange } from '@/lib/period'
import type { DailyPoint, SalesSummary } from '@/services/reports'
import { mockApi, ownerMe, staffMe } from '@/test/api'
import { page, product } from '@/test/fixtures'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const today = storeToday(new Date(), 'Asia/Jakarta')
const week = presetRange('7d', today)

// Golden figures from the backend fixture (docs/api/reports.md).
const summary: SalesSummary = {
  gross_sales: 246607, discount_total: 5107, net_sales: 241500, transaction_count: 4, avg_transaction_value: 60375,
  cogs: 186330, gross_profit: 55170, voided_count: 1, voided_net_total: 65000,
}
const period = (from = week.from, to = week.to) => ({ from, to, timezone: 'Asia/Jakarta', days: 7, generated_at: new Date().toISOString() })
const daily: DailyPoint[] = Array.from({ length: 7 }, (_, i) => ({
  date: addDays(week.from, i),
  net_sales: [0, 0, 0, 0, 164500, 68000, 9000][i] ?? 0,
  transaction_count: [0, 0, 0, 0, 2, 1, 1][i] ?? 0,
}))
const top = [
  { rank: 1, product_id: 'p1', product_name: 'Kopi Arabica', sku: 'KOP', unit: 'pcs', quantity_sold: '3.000', revenue: 204000, transaction_count: 2 },
  { rank: 2, product_id: 'p2', product_name: 'Beras Pandan', sku: 'BRS', unit: 'kg', quantity_sold: '1.833', revenue: 22607, transaction_count: 2 },
]

function dashRoutes(overrides: Record<string, unknown> = {}) {
  return {
    'GET /me': () => ({ body: ownerMe }),
    'GET /dashboard/summary': ({ search }: { search: URLSearchParams }) => ({
      body: { period: period(search.get('from') ?? week.from, search.get('to') ?? week.to), sales: summary, active_products: 4, low_stock_count: 1, out_of_stock_count: 0, ...overrides },
    }),
    'GET /dashboard/sales-trend': () => ({ body: { period: period(), data: daily } }),
    'GET /dashboard/top-products': () => ({ body: { period: period(), data: top } }),
    'GET /products': () => ({ body: page([product({ name: 'Teh Melati', current_stock: '96.000', min_stock: '100.000', stock_status: 'LOW' })]) }),
  }
}

describe('DashboardPage', () => {
  it('shows server KPIs with one hero figure and the void note', async () => {
    const { calls } = mockApi(dashRoutes())
    renderApp('/dashboard')
    const kpis = await screen.findByText('Penjualan bersih')
    const hero = kpis.closest('div') as HTMLElement
    await waitFor(() => expect(hero).toHaveTextContent('Rp 241.500'))
    expect(hero).toHaveTextContent('Rp 246.607 kotor − Rp 5.107 diskon')
    expect(screen.getByText('Rp 60.375')).toBeInTheDocument()
    expect(screen.getByText('Rp 55.170')).toBeInTheDocument()
    expect(screen.getByText(/1 transaksi void \(Rp 65.000\) tidak dihitung/)).toBeInTheDocument()
    const req = calls.find((c) => c.path === '/dashboard/summary')
    expect(req?.search.get('from')).toBe(week.from) // default: last 7 days in store time
    expect(req?.search.get('to')).toBe(today)
  })

  it('switches period presets and re-requests with the new range', async () => {
    const { calls } = mockApi(dashRoutes())
    const user = userEvent.setup()
    const { router } = renderApp('/dashboard')
    await screen.findByText('Penjualan bersih')
    await user.click(screen.getByRole('radio', { name: 'Hari ini' }))
    await waitFor(() => expect(router.state.location.search).toBe('?range=today'))
    await waitFor(() => expect(calls.filter((c) => c.path === '/dashboard/summary').at(-1)?.search.get('from')).toBe(today))
  })

  it('renders the trend chart with keyboard tooltips, a single peak label and a table view', async () => {
    mockApi(dashRoutes())
    const user = userEvent.setup()
    renderApp('/dashboard')
    const chart = await screen.findByRole('list', { name: /Penjualan bersih harian, 7 hari/ })
    const bars = within(chart).getAllByRole('button')
    expect(bars).toHaveLength(7)
    expect(bars[4]).toHaveAccessibleName(/Rp 164.500, 2 transaksi/)
    bars[6]?.focus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Rp 9.000')
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Rp 68.000')
    await user.click(screen.getAllByRole('button', { name: /Lihat tabel/ })[0] as HTMLElement)
    const table = screen.getByRole('table', { name: 'Penjualan bersih harian' })
    expect(within(table).getAllByRole('row')).toHaveLength(8)
  })

  it('lists top products and low stock from real data', async () => {
    mockApi(dashRoutes())
    renderApp('/dashboard')
    const topList = await screen.findByRole('list', { name: 'Produk terlaris berdasarkan penjualan' })
    const items = within(topList).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Kopi Arabica')
    expect(items[0]).toHaveTextContent('Rp 204.000')
    expect(items[1]).toHaveTextContent('1,833 kg')
    expect(await screen.findByText('Teh Melati')).toBeInTheDocument()
    expect(screen.getByText('4 aktif · 1 rendah · 0 habis')).toBeInTheDocument()
  })

  it('shows a getting-started checklist (no fake numbers) for an empty store', async () => {
    mockApi(dashRoutes({ active_products: 0, sales: { ...summary, net_sales: 0, gross_sales: 0, discount_total: 0, transaction_count: 0, avg_transaction_value: 0, cogs: 0, gross_profit: 0, voided_count: 0, voided_net_total: 0 } }))
    renderApp('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Buku tokomu siap diisi.' })).toBeInTheDocument()
    expect(screen.queryByText(/Rp \d/)).not.toBeInTheDocument()
  })
})

describe('ReportsPage', () => {
  const reportRoutes = (status = 200) => ({
    'GET /me': () => ({ body: staffMe }),
    'GET /reports/sales': () =>
      status === 200
        ? {
            body: {
              period: period(), summary, top_products: top, daily,
              payment_methods: [{ payment_method: 'CASH', transaction_count: 2, net_sales: 217500 }, { payment_method: 'QRIS', transaction_count: 2, net_sales: 24000 }],
            },
          }
        : { status, body: { error: { code: 'VALIDATION_ERROR', message: 'Periksa kembali isian formulir.', details: { fields: { to: 'Rentang maksimal 366 hari.' } } } } },
  })

  it('reads like an income statement and offers a CSV of the same period', async () => {
    mockApi(reportRoutes())
    renderApp('/reports')
    const statement = await screen.findByRole('region', { name: 'Ringkasan' })
    expect(statement).toHaveTextContent('Penjualan kotor')
    expect(statement).toHaveTextContent('Rp 246.607')
    expect(statement).toHaveTextContent('−Rp 5.107')
    expect(statement).toHaveTextContent('Rp 241.500')
    expect(statement).toHaveTextContent('−Rp 186.330')
    expect(statement).toHaveTextContent('Rp 55.170')
    expect(statement).toHaveTextContent('22,8%') // 55.170 / 241.500
    expect(statement).toHaveTextContent('1 transaksi void senilai Rp 65.000 dikecualikan')
    const pay = screen.getByRole('table', { name: /metode pembayaran/ })
    expect(within(pay).getAllByRole('row')[1]).toHaveTextContent('Tunai')
    const csv = screen.getByRole('link', { name: /Unduh CSV/ })
    expect(csv).toHaveAttribute('href', `/api/v1/reports/sales/export?from=${week.from}&to=${today}`)
  })

  it('shows the server validation message for an invalid range', async () => {
    mockApi(reportRoutes(400))
    renderApp('/reports?range=custom&from=2025-01-01&to=2026-11-10')
    expect(await screen.findByText('Rentang maksimal 366 hari.')).toBeInTheDocument()
  })
})
