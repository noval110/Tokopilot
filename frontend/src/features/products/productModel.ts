import { normalizeQuantityInput, quantityError } from '@/lib/quantity'
import type { Product, ProductPayload } from '@/services/catalog'

export interface ProductFormValues {
  name: string
  sku: string
  category_id: string
  unit: string
  unit_scale: number
  cost_price: number | null
  selling_price: number | null
  initial_stock: string
  min_stock: string
}

export type ProductFormErrors = Partial<Record<keyof ProductFormValues, string>>

export const emptyProduct: ProductFormValues = {
  name: '',
  sku: '',
  category_id: '',
  unit: 'pcs',
  unit_scale: 0,
  cost_price: null,
  selling_price: null,
  initial_stock: '',
  min_stock: '',
}

/** Shows a NUMERIC string the way a user would type it: "2.500" → "2,5". */
export function qtyToInput(q: string): string {
  const [w = '0', f = ''] = q.split('.')
  const frac = f.replace(/0+$/, '')
  return frac ? `${w},${frac}` : w
}

export function fromProduct(p: Product): ProductFormValues {
  return {
    name: p.name,
    sku: p.sku ?? '',
    category_id: p.category?.id ?? '',
    unit: p.unit,
    unit_scale: p.unit_scale,
    cost_price: p.cost_price,
    selling_price: p.selling_price,
    initial_stock: '',
    min_stock: qtyToInput(p.min_stock),
  }
}

/** Mirrors backend rules for instant feedback; the API remains authoritative. */
export function validateProduct(v: ProductFormValues, creating: boolean): ProductFormErrors {
  const e: ProductFormErrors = {}
  if (!v.name.trim()) e.name = 'Nama produk wajib diisi.'
  else if (v.name.trim().length > 150) e.name = 'Nama produk maksimal 150 karakter.'
  if (v.sku.trim() && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v.sku.trim()))
    e.sku = 'SKU hanya huruf, angka, titik, strip, atau garis bawah (maks. 64).'
  if (!v.unit.trim()) e.unit = 'Satuan wajib diisi.'
  else if (v.unit.trim().length > 20) e.unit = 'Satuan maksimal 20 karakter.'
  if (v.cost_price === null) e.cost_price = 'Harga modal wajib diisi.'
  if (v.selling_price === null) e.selling_price = 'Harga jual wajib diisi.'
  const minErr = quantityError(v.min_stock, v.unit_scale, 'Stok minimum')
  if (minErr) e.min_stock = minErr
  if (creating) {
    const initErr = quantityError(v.initial_stock, v.unit_scale, 'Stok awal')
    if (initErr) e.initial_stock = initErr
  }
  return e
}

export function toPayload(v: ProductFormValues): ProductPayload {
  return {
    name: v.name.trim(),
    sku: v.sku.trim(),
    category_id: v.category_id,
    unit: v.unit.trim(),
    unit_scale: v.unit_scale,
    cost_price: v.cost_price ?? 0,
    selling_price: v.selling_price ?? 0,
    min_stock: normalizeQuantityInput(v.min_stock) || '0',
  }
}

/** Margin preview — display only; reports compute margin server-side (BR-11). */
export function margin(cost: number | null, price: number | null): { amount: number; pct: number | null } | null {
  if (cost === null || price === null) return null
  const amount = price - cost
  return { amount, pct: price > 0 ? Math.round((amount / price) * 1000) / 10 : null }
}
