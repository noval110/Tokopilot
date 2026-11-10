import { apiFetch } from '@/lib/api'
import type { PaymentMethod } from './sales'

export interface Period {
  from: string
  to: string
  timezone: string
  days: number
  generated_at: string
}

export interface SalesSummary {
  gross_sales: number
  discount_total: number
  net_sales: number
  transaction_count: number
  avg_transaction_value: number
  cogs: number
  gross_profit: number
  voided_count: number
  voided_net_total: number
}

export interface DailyPoint {
  date: string
  net_sales: number
  transaction_count: number
}

export interface TopProduct {
  rank: number
  product_id: string | null
  product_name: string
  sku: string | null
  unit: string
  quantity_sold: string
  revenue: number
  transaction_count: number
}

export interface DashboardSummary {
  period: Period
  sales: SalesSummary
  active_products: number
  low_stock_count: number
  out_of_stock_count: number
}

export interface SalesReport {
  period: Period
  summary: SalesSummary
  top_products: TopProduct[]
  payment_methods: Array<{ payment_method: PaymentMethod; transaction_count: number; net_sales: number }>
  daily: DailyPoint[]
}

export interface RangeParams {
  from?: string
  to?: string
}

const qs = (p: RangeParams & { limit?: number }) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') s.set(k, String(v))
  const str = s.toString()
  return str ? `?${str}` : ''
}

export const reportsApi = {
  dashboard: (p: RangeParams) => apiFetch<DashboardSummary>(`/dashboard/summary${qs(p)}`),
  trend: (p: RangeParams) => apiFetch<{ period: Period; data: DailyPoint[] }>(`/dashboard/sales-trend${qs(p)}`),
  topProducts: (p: RangeParams & { limit?: number }) => apiFetch<{ period: Period; data: TopProduct[] }>(`/dashboard/top-products${qs(p)}`),
  sales: (p: RangeParams) => apiFetch<SalesReport>(`/reports/sales${qs(p)}`),
  /** Same-origin GET with the session cookie; the browser downloads the file. */
  exportUrl: (p: RangeParams) => `${import.meta.env.VITE_API_BASE_URL ?? '/api/v1'}/reports/sales/export${qs(p)}`,
}

export const reportKeys = {
  dashboard: (p: RangeParams) => ['reports', 'dashboard', p] as const,
  trend: (p: RangeParams) => ['reports', 'trend', p] as const,
  top: (p: RangeParams) => ['reports', 'top', p] as const,
  sales: (p: RangeParams) => ['reports', 'sales', p] as const,
}
