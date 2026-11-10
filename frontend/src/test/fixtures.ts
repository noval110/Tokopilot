import type { Product } from '@/services/catalog'
import type { Movement } from '@/services/inventory'

/** Synthetic catalog fixtures for tests — never real store data. */
export function product(overrides: Partial<Product> = {}): Product {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Kopi Arabica 250g',
    sku: 'KOP-250',
    category: { id: 'cat-1', name: 'Minuman' },
    unit: 'pcs',
    unit_scale: 0,
    cost_price: 52000,
    selling_price: 68000,
    current_stock: '24.000',
    min_stock: '5.000',
    stock_status: 'OK',
    is_active: true,
    archived_at: null,
    created_at: '2026-11-10T02:00:00Z',
    updated_at: '2026-11-10T02:00:00Z',
    ...overrides,
  }
}

export const page = <T,>(data: T[], total = data.length) => ({ data, meta: { page: 1, per_page: 20, total } })

export function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 'mv-1',
    product: { id: '11111111-1111-4111-8111-111111111111', name: 'Kopi Arabica 250g', sku: 'KOP-250', unit: 'pcs', unit_scale: 0 },
    type: 'RESTOCK',
    quantity_delta: '20.000',
    stock_before: '4.000',
    stock_after: '24.000',
    reason_code: null,
    note: 'Supplier Pak Budi',
    actor: { id: 'u1', name: 'Sari Wulandari' },
    reference_type: null,
    reference_id: null,
    created_at: '2026-11-10T02:12:00Z',
    ...overrides,
  }
}

export const categories = { data: [{ id: 'cat-1', name: 'Minuman', product_count: 1, archived_at: null }] }
