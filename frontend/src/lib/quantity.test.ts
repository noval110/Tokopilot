import { describe, expect, it } from 'vitest'
import { addQuantity, compareQuantity, gaugeRatio, normalizeQuantityInput, quantityError } from './quantity'

describe('quantity helpers', () => {
  it('accepts Indonesian comma decimals', () => {
    expect(normalizeQuantityInput(' 2,5 ')).toBe('2.5')
  })

  it('validates against the unit scale like the backend', () => {
    expect(quantityError('10', 0, 'Stok')).toBeUndefined()
    expect(quantityError('2,000', 0, 'Stok')).toBeUndefined()
    expect(quantityError('2,5', 0, 'Stok')).toMatch(/bilangan bulat/)
    expect(quantityError('2,125', 2, 'Stok')).toMatch(/maksimal 2/)
    expect(quantityError('-1', 3, 'Stok')).toMatch(/≥ 0/)
    expect(quantityError('1e3', 3, 'Stok')).toMatch(/≥ 0/)
    expect(quantityError('', 0, 'Stok')).toBeUndefined()
  })

  it('compares NUMERIC strings exactly', () => {
    expect(compareQuantity('5.000', '5')).toBe(0)
    expect(compareQuantity('10.000', '9.999')).toBe(1)
    expect(compareQuantity('0.001', '0.010')).toBe(-1)
    expect(compareQuantity('100', '20')).toBe(1)
  })

  it('adds quantities exactly without floating point', () => {
    expect(addQuantity('24.000', '20')).toBe('44.000')
    expect(addQuantity('0.1', '0.2')).toBe('0.300') // 0.1 + 0.2 !== 0.3 in float
    expect(addQuantity('3.000', '-3')).toBe('0.000')
    expect(addQuantity('2.000', '-3.5')).toBe('-1.500')
    expect(addQuantity('12345678901.125', '0.875')).toBe('12345678902.000')
  })

  it('sizes the gauge with min stock at the midpoint', () => {
    expect(gaugeRatio('5.000', '5.000')).toBe(0.5)
    expect(gaugeRatio('50', '5')).toBe(1)
    expect(gaugeRatio('0', '5')).toBe(0)
    expect(gaugeRatio('3', '0')).toBe(1)
  })
})
