import { apiFetch } from '@/lib/api'
import type { Page } from './auth'

export type StockStatus = 'OK' | 'LOW' | 'OUT'

export interface CategoryRef {
  id: string
  name: string
}

export interface Category extends CategoryRef {
  product_count?: number
  archived_at: string | null
}

export interface Product {
  id: string
  name: string
  sku: string | null
  category: CategoryRef | null
  unit: string
  unit_scale: number
  cost_price: number
  selling_price: number
  /** NUMERIC(14,3) as a string, e.g. "24.000" — never parsed to float for logic. */
  current_stock: string
  min_stock: string
  stock_status: StockStatus
  is_active: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface ProductPayload {
  name: string
  sku: string
  category_id: string
  unit: string
  unit_scale: number
  cost_price: number
  selling_price: number
  min_stock: string
}

export interface ProductListParams {
  q?: string
  category_id?: string
  stock_status?: 'low' | 'out' | 'ok' | ''
  status?: 'active' | 'archived' | 'all' | ''
  sort?: 'name' | '-updated_at' | 'stock' | ''
  page?: number
  per_page?: number
}

function qs(params: object): string {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) s.set(k, String(v))
  }
  const str = s.toString()
  return str ? `?${str}` : ''
}

export const catalogApi = {
  products: (p: ProductListParams) => apiFetch<Page<Product>>(`/products${qs(p)}`),
  product: (id: string) => apiFetch<Product>(`/products/${encodeURIComponent(id)}`),
  createProduct: (body: ProductPayload & { initial_stock: string }) =>
    apiFetch<Product>('/products', { method: 'POST', body }),
  updateProduct: (id: string, body: Partial<ProductPayload>) =>
    apiFetch<Product>(`/products/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  archiveProduct: (id: string) => apiFetch<Product>(`/products/${encodeURIComponent(id)}/archive`, { method: 'POST' }),

  categories: (includeArchived = false) =>
    apiFetch<{ data: Category[] }>(`/categories${includeArchived ? '?include_archived=true' : ''}`),
  createCategory: (name: string) => apiFetch<Category>('/categories', { method: 'POST', body: { name } }),
  renameCategory: (id: string, name: string) =>
    apiFetch<Category>(`/categories/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
  archiveCategory: (id: string) =>
    apiFetch<undefined>(`/categories/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
}

export const catalogKeys = {
  products: (p: ProductListParams) => ['products', 'list', p] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  categories: ['categories'] as const,
}

/** Common units with sensible decimal places (ADR-0005). Owners may type their own. */
export const UNIT_PRESETS: Array<{ unit: string; scale: number }> = [
  { unit: 'pcs', scale: 0 },
  { unit: 'botol', scale: 0 },
  { unit: 'bungkus', scale: 0 },
  { unit: 'sachet', scale: 0 },
  { unit: 'pak', scale: 0 },
  { unit: 'dus', scale: 0 },
  { unit: 'lusin', scale: 0 },
  { unit: 'kg', scale: 3 },
  { unit: 'gram', scale: 0 },
  { unit: 'liter', scale: 3 },
  { unit: 'ml', scale: 0 },
  { unit: 'meter', scale: 2 },
]
