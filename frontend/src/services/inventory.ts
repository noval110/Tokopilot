import { apiFetch } from '@/lib/api'
import type { Page } from './auth'
import type { Product } from './catalog'

export type MovementType = 'INITIAL' | 'RESTOCK' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'SALE' | 'SALE_VOID'
export type ReasonCode = 'DAMAGED' | 'LOST' | 'EXPIRED' | 'COUNT_CORRECTION' | 'OTHER'

export interface Movement {
  id: string
  product: { id: string; name: string; sku: string | null; unit: string; unit_scale: number }
  type: MovementType
  /** Signed NUMERIC string, e.g. "-3.000". */
  quantity_delta: string
  stock_before: string
  stock_after: string
  reason_code: ReasonCode | null
  note: string | null
  actor: { id: string; name: string }
  reference_type: string | null
  reference_id: string | null
  created_at: string
}

export interface StockChangeResult {
  product: Product
  movement: Movement
}

export interface InventorySummary {
  active_products: number
  low_stock: number
  out_of_stock: number
}

export interface MovementParams {
  product_id?: string
  type?: MovementType | ''
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

export const inventoryApi = {
  summary: () => apiFetch<InventorySummary>('/inventory/summary'),
  movements: (p: MovementParams) => apiFetch<Page<Movement>>(`/inventory/movements${qs(p)}`),
  restock: (body: { product_id: string; quantity: string; note?: string }) =>
    apiFetch<StockChangeResult>('/inventory/restocks', { method: 'POST', body }),
  adjust: (body: { product_id: string; direction: 'IN' | 'OUT'; quantity: string; reason_code: ReasonCode; note?: string }) =>
    apiFetch<StockChangeResult>('/inventory/adjustments', { method: 'POST', body }),
}

export const inventoryKeys = {
  summary: ['inventory', 'summary'] as const,
  movements: (p: MovementParams) => ['inventory', 'movements', p] as const,
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  INITIAL: 'Stok awal',
  RESTOCK: 'Restock',
  ADJUSTMENT_IN: 'Koreksi masuk',
  ADJUSTMENT_OUT: 'Koreksi keluar',
  SALE: 'Penjualan',
  SALE_VOID: 'Pembatalan',
}

export const REASONS: Array<{ code: ReasonCode; label: string; hint: string }> = [
  { code: 'DAMAGED', label: 'Rusak', hint: 'Pecah, cacat, atau tidak layak jual' },
  { code: 'LOST', label: 'Hilang', hint: 'Selisih karena hilang atau dicuri' },
  { code: 'EXPIRED', label: 'Kedaluwarsa', hint: 'Lewat tanggal kedaluwarsa' },
  { code: 'COUNT_CORRECTION', label: 'Salah hitung', hint: 'Koreksi hasil stok opname' },
  { code: 'OTHER', label: 'Lainnya', hint: 'Wajib dijelaskan di catatan' },
]

export const reasonLabel = (code: ReasonCode | null) => REASONS.find((r) => r.code === code)?.label
