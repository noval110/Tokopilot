import { describe, expect, it } from 'vitest'
import { cartSubtotal, lineTotal } from './money'

describe('lineTotal mirrors the backend half-up rounding', () => {
  it.each([
    [68000, '2', 136000],
    [12333, '1.5', 18500], // 18.499,5 → 18.500
    [12333, '1,5', 18500], // Indonesian comma
    [12333, '1.499', 18487],
    [1, '0.5', 1],
    [1, '0.499', 0],
    [15000, '12.125', 181875],
  ])('Rp %i × %s = Rp %i', (price, qty, want) => {
    expect(lineTotal(price, qty)).toBe(want)
  })

  it('treats malformed quantities as zero rather than NaN', () => {
    expect(lineTotal(1000, 'abc')).toBe(0)
    expect(lineTotal(1000, '')).toBe(0)
  })

  it('sums a cart', () => {
    expect(cartSubtotal([{ unitPrice: 68000, quantity: '2' }, { unitPrice: 12333, quantity: '1.5' }])).toBe(154500)
  })
})
