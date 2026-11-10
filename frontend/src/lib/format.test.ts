import { describe, expect, it } from 'vitest'
import { formatDelta, formatIDR, formatQuantity, formatStoreDate, formatStoreDateTime, storeToday, timezoneLabel } from './format'

describe('formatIDR', () => {
  it('formats integer rupiah with Indonesian thousand separators', () => {
    expect(formatIDR(136000)).toBe('Rp 136.000')
    expect(formatIDR(0)).toBe('Rp 0')
    expect(formatIDR(1250000000)).toBe('Rp 1.250.000.000')
  })

  it('refuses fractional amounts instead of silently rounding', () => {
    expect(() => formatIDR(1500.5)).toThrow(RangeError)
  })
})

describe('formatQuantity', () => {
  it('keeps decimal precision without floating point', () => {
    expect(formatQuantity('2.000')).toBe('2')
    expect(formatQuantity('2.500', 'kg')).toBe('2,5 kg')
    expect(formatQuantity('12345.125')).toBe('12.345,125')
    expect(formatQuantity('-3.000', 'pcs')).toBe('-3 pcs')
  })

  it('rejects malformed input', () => {
    expect(() => formatQuantity('1e3')).toThrow(RangeError)
    expect(() => formatQuantity('')).toThrow(RangeError)
  })
})

describe('store time', () => {
  it('formats dates in Asia/Jakarta, not the browser timezone', () => {
    // 2026-11-09T18:30Z is already 10 November 01:30 in Jakarta (UTC+7).
    expect(formatStoreDate(new Date('2026-11-09T18:30:00Z'))).toBe('Selasa, 10 November 2026')
  })

  it('formats date-times and "today" in the store zone', () => {
    const t = new Date('2026-11-09T17:30:00Z') // 00:30 on 10 Nov in WIB, 01:30 in WITA
    expect(formatStoreDateTime(t)).toMatch(/^10 Nov 2026,? 00[.:]30$/)
    expect(storeToday(t)).toBe('2026-11-10')
    expect(storeToday(new Date('2026-11-09T16:30:00Z'))).toBe('2026-11-09')
  })

  it('formats signed deltas with a typographic minus', () => {
    expect(formatDelta('-3.000', 'pcs')).toBe('−3 pcs')
    expect(formatDelta('20.000')).toBe('+20')
    expect(formatDelta('1.250', 'kg')).toBe('+1,25 kg')
  })

  it('labels Indonesian zones', () => {
    expect(timezoneLabel()).toBe('WIB')
    expect(timezoneLabel('Asia/Makassar')).toBe('WITA')
    expect(timezoneLabel('Europe/Paris')).toBe('Europe/Paris')
  })
})
