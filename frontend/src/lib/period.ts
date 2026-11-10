/**
 * Report periods as store-local calendar dates (YYYY-MM-DD). Date strings are
 * shifted with UTC arithmetic so the browser's own timezone never leaks in;
 * "today" comes from storeToday() in the store timezone.
 */

export type Preset = 'today' | '7d' | '30d' | 'custom'

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function presetRange(preset: Exclude<Preset, 'custom'>, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
  }
}

const monthShort = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayMonthYear = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "4–10 Nov 2026", "28 Okt s.d. 3 Nov 2026", "10 Nov 2026". */
export function formatPeriod(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00Z`)
  const t = new Date(`${to}T00:00:00Z`)
  if (from === to) return dayMonthYear.format(t)
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear()
  const sameMonth = sameYear && f.getUTCMonth() === t.getUTCMonth()
  if (sameMonth) return `${f.getUTCDate()}–${dayMonthYear.format(t)}`
  return `${sameYear ? monthShort.format(f) : dayMonthYear.format(f)} s.d. ${dayMonthYear.format(t)}`
}

/** Short axis label for a local date: "4 Nov". */
export function formatDay(date: string): string {
  return monthShort.format(new Date(`${date}T00:00:00Z`))
}

const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 })

/** Compact rupiah for axis ticks: 0, 100 rb, 1,2 jt. */
export function formatIDRCompact(v: number): string {
  return v === 0 ? '0' : compact.format(v).replace(/\u00a0/g, ' ')
}

/** Clean axis maximum and ticks (0 + 3 steps of 1/2/2.5/5 × 10^n). */
export function niceTicks(max: number, steps = 3): number[] {
  if (max <= 0) return [0]
  const raw = max / steps
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  return Array.from({ length: steps + 1 }, (_, i) => i * step)
}
