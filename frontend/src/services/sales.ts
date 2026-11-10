import { apiFetch } from '@/lib/api'
import type { Page } from './auth'

export type SaleStatus = 'COMPLETED' | 'VOIDED'
export type PaymentMethod = 'CASH' | 'TRANSFER' | 'QRIS' | 'OTHER'

export interface SaleItem {
  line_no: number
  product_id: string | null
  product_name: string
  sku: string | null
  unit: string
  unit_scale: number
  quantity: string
  unit_price: number
  line_subtotal: number
}

export interface Sale {
  id: string
  sale_number: string
  status: SaleStatus
  subtotal: number
  discount_amount: number
  net_total: number
  payment_method: PaymentMethod
  notes: string | null
  cashier: { id: string; name: string }
  sold_at: string
  item_count: number
  void: { reason: string; by: { id: string; name: string }; at: string } | null
  items?: SaleItem[]
}

export interface CheckoutPayload {
  idempotency_key: string
  items: Array<{ product_id: string; quantity: string }>
  discount_amount: number
  payment_method: PaymentMethod
  notes?: string
}

export interface SaleListParams {
  q?: string
  status?: SaleStatus | ''
  payment_method?: PaymentMethod | ''
  from?: string
  to?: string
  page?: number
  per_page?: number
}

function qs(params: object): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== null) s.set(k, String(v))
  const str = s.toString()
  return str ? `?${str}` : ''
}

export const salesApi = {
  checkout: (body: CheckoutPayload) => apiFetch<Sale>('/sales', { method: 'POST', body }),
  list: (p: SaleListParams) => apiFetch<Page<Sale>>(`/sales${qs(p)}`),
  get: (id: string) => apiFetch<Sale>(`/sales/${encodeURIComponent(id)}`),
  void: (id: string, reason: string) => apiFetch<Sale>(`/sales/${encodeURIComponent(id)}/void`, { method: 'POST', body: { reason } }),
}

export const salesKeys = {
  list: (p: SaleListParams) => ['sales', 'list', p] as const,
  detail: (id: string) => ['sales', 'detail', id] as const,
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Tunai',
  TRANSFER: 'Transfer',
  QRIS: 'QRIS',
  OTHER: 'Lainnya',
}
