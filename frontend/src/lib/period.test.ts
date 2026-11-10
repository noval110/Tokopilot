import { describe, expect, it } from 'vitest'
import { addDays, formatDay, formatIDRCompact, formatPeriod, niceTicks, presetRange } from './period'

describe('period helpers', () => {
  it('shifts dates across month and year boundaries without timezone drift', () => {
    expect(addDays('2026-11-10', -6)).toBe('2026-11-04')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('builds presets ending today (store-local)', () => {
    expect(presetRange('today', '2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-11-10' })
    expect(presetRange('7d', '2026-11-10')).toEqual({ from: '2026-11-04', to: '2026-11-10' })
    expect(presetRange('30d', '2026-11-10')).toEqual({ from: '2026-10-12', to: '2026-11-10' })
  })

  it('formats periods compactly in Indonesian', () => {
    expect(formatPeriod('2026-11-04', '2026-11-10')).toBe('4–10 Nov 2026')
    expect(formatPeriod('2026-10-28', '2026-11-03')).toBe('28 Okt s.d. 3 Nov 2026')
    expect(formatPeriod('2026-11-10', '2026-11-10')).toBe('10 Nov 2026')
    expect(formatDay('2026-11-04')).toBe('4 Nov')
  })

  it('makes clean axis ticks and compact rupiah labels', () => {
    expect(niceTicks(164500)).toEqual([0, 100000, 200000, 300000])
    expect(niceTicks(9000)).toEqual([0, 5000, 10000, 15000])
    expect(niceTicks(0)).toEqual([0])
    expect(formatIDRCompact(0)).toBe('0')
    expect(formatIDRCompact(100000)).toMatch(/^100 rb$/)
    expect(formatIDRCompact(1200000)).toMatch(/^1,2 jt$/)
  })
})
