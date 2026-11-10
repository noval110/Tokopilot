import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { product } from '@/test/fixtures'
import { cartReducer, emptyCart, toPayload, useIdempotencyKey } from './cart'

const kopi = product()
const beras = product({ id: 'b', name: 'Beras', unit: 'kg', unit_scale: 3, selling_price: 12333 })

describe('cartReducer', () => {
  it('merges repeated adds into one line', () => {
    let s = cartReducer(emptyCart, { type: 'add', product: kopi })
    s = cartReducer(s, { type: 'add', product: kopi })
    expect(s.lines).toHaveLength(1)
    expect(s.lines[0]?.quantity).toBe('2')
  })

  it('steps quantities exactly and removes a line stepped below 1', () => {
    let s = cartReducer(emptyCart, { type: 'add', product: beras })
    s = cartReducer(s, { type: 'qty', productId: 'b', quantity: '1,5' })
    s = cartReducer(s, { type: 'step', productId: 'b', delta: 1 })
    expect(s.lines[0]?.quantity).toBe('2.5')
    s = cartReducer(s, { type: 'step', productId: 'b', delta: -1 })
    s = cartReducer(s, { type: 'step', productId: 'b', delta: -1 })
    expect(s.lines[0]?.quantity).toBe('0.5')
    s = cartReducer(s, { type: 'step', productId: 'b', delta: -1 })
    expect(s.lines).toHaveLength(0)
  })

  it('builds the payload with dot decimals and no prices', () => {
    let s = cartReducer(emptyCart, { type: 'add', product: beras })
    s = cartReducer(s, { type: 'qty', productId: 'b', quantity: '1,5' })
    s = cartReducer(s, { type: 'discount', value: 500 })
    s = cartReducer(s, { type: 'payment', value: 'QRIS' })
    const p = toPayload(s, 'k')
    expect(p).toEqual({ idempotency_key: 'k', items: [{ product_id: 'b', quantity: '1.5' }], discount_amount: 500, payment_method: 'QRIS' })
    expect(JSON.stringify(p)).not.toMatch(/price/)
  })
})

describe('useIdempotencyKey', () => {
  it('reuses the key for the same cart and rotates it when the cart changes', () => {
    const { result } = renderHook(() => useIdempotencyKey())
    const a = cartReducer(emptyCart, { type: 'add', product: kopi })
    const k1 = result.current.keyFor(a)
    expect(result.current.keyFor(a)).toBe(k1) // retry → same key
    const b = cartReducer(a, { type: 'add', product: kopi })
    const k2 = result.current.keyFor(b)
    expect(k2).not.toBe(k1) // different cart → new key
    result.current.reset()
    expect(result.current.keyFor(b)).not.toBe(k2) // after success → new key
  })
})
