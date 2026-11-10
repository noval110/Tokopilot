import { useEffect, useReducer, useRef } from 'react'
import { addQuantity, normalizeQuantityInput } from '@/lib/quantity'
import type { Product } from '@/services/catalog'
import type { CheckoutPayload, PaymentMethod } from '@/services/sales'

/** A cart line keeps a display snapshot; the server re-reads real prices. */
export interface CartLine {
  productId: string
  name: string
  sku: string | null
  unit: string
  unitScale: number
  unitPrice: number
  stock: string
  quantity: string // as typed (may use a comma)
}

export interface CartState {
  lines: CartLine[]
  discount: number | null
  payment: PaymentMethod
  notes: string
}

type Action =
  | { type: 'add'; product: Product }
  | { type: 'qty'; productId: string; quantity: string }
  | { type: 'step'; productId: string; delta: 1 | -1 }
  | { type: 'remove'; productId: string }
  | { type: 'discount'; value: number | null }
  | { type: 'payment'; value: PaymentMethod }
  | { type: 'notes'; value: string }
  | { type: 'clear' }

export const emptyCart: CartState = { lines: [], discount: null, payment: 'CASH', notes: '' }

function canonical(q: string): string {
  const n = normalizeQuantityInput(q)
  return /^\d+(\.\d{1,3})?$/.test(n) ? n : '0'
}

export function cartReducer(state: CartState, a: Action): CartState {
  switch (a.type) {
    case 'add': {
      const existing = state.lines.find((l) => l.productId === a.product.id)
      if (existing) {
        return {
          ...state,
          lines: state.lines.map((l) =>
            l.productId === a.product.id ? { ...l, quantity: addQuantity(canonical(l.quantity), '1').replace(/\.?0+$/, '') || '0' } : l,
          ),
        }
      }
      const p = a.product
      return {
        ...state,
        lines: [
          ...state.lines,
          { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, unitScale: p.unit_scale, unitPrice: p.selling_price, stock: p.current_stock, quantity: '1' },
        ],
      }
    }
    case 'qty':
      return { ...state, lines: state.lines.map((l) => (l.productId === a.productId ? { ...l, quantity: a.quantity } : l)) }
    case 'step':
      return {
        ...state,
        lines: state.lines.flatMap((l) => {
          if (l.productId !== a.productId) return [l]
          const next = addQuantity(canonical(l.quantity), a.delta === 1 ? '1' : '-1')
          if (next.startsWith('-') || /^0\.000$/.test(next)) return a.delta === -1 ? [] : [l]
          return [{ ...l, quantity: next.replace(/\.?0+$/, '') }]
        }),
      }
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.productId !== a.productId) }
    case 'discount':
      return { ...state, discount: a.value }
    case 'payment':
      return { ...state, payment: a.value }
    case 'notes':
      return { ...state, notes: a.value }
    case 'clear':
      return emptyCart
  }
}

/** Cart persisted per store in sessionStorage (survives an accidental refresh). */
export function useCart(storeId: string) {
  const key = `tokopilot.cart.${storeId}`
  const [state, dispatch] = useReducer(cartReducer, undefined, () => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw ? { ...emptyCart, ...(JSON.parse(raw) as CartState) } : emptyCart
    } catch {
      return emptyCart
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state))
    } catch {
      /* storage unavailable — the cart just isn't remembered */
    }
  }, [key, state])
  return [state, dispatch] as const
}

export function toPayload(state: CartState, key: string): CheckoutPayload {
  const notes = state.notes.trim()
  return {
    idempotency_key: key,
    items: state.lines.map((l) => ({ product_id: l.productId, quantity: normalizeQuantityInput(l.quantity) })),
    discount_amount: state.discount ?? 0,
    payment_method: state.payment,
    ...(notes ? { notes } : {}),
  }
}

/**
 * One idempotency key per distinct cart. Retrying the same cart (network
 * error, double click) reuses the key so the server replays instead of
 * creating a duplicate; any change to the cart gets a fresh key.
 */
export function useIdempotencyKey() {
  const ref = useRef<{ fingerprint: string; key: string } | null>(null)
  return {
    keyFor(state: CartState): string {
      const fp = JSON.stringify(toPayload(state, ''))
      if (ref.current?.fingerprint !== fp) ref.current = { fingerprint: fp, key: crypto.randomUUID() }
      return ref.current.key
    },
    reset() {
      ref.current = null
    },
  }
}
