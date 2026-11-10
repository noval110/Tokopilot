/**
 * Display formatting only. The backend is the source of truth for every
 * amount; these helpers never round or recompute money.
 */

export const STORE_TIMEZONE_DEFAULT = 'Asia/Jakarta'

const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Formats an integer rupiah amount, e.g. 136000 → "Rp 136.000". */
export function formatIDR(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`formatIDR expects an integer rupiah amount, got ${amount}`)
  }
  // Intl emits a non-breaking space after "Rp"; normalise for consistent layout.
  return idr.format(amount).replace(/\u00a0/g, ' ')
}

/**
 * Formats a decimal quantity string from the API ("2.500") using Indonesian
 * separators ("2,5"). Strings are kept as strings so NUMERIC(14,3) precision
 * is never pushed through floating point.
 */
export function formatQuantity(value: string, unit?: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (!match) throw new RangeError(`Invalid quantity: ${value}`)
  const [, sign = '', whole = '0', frac = ''] = match
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const trimmedFrac = frac.replace(/0+$/, '')
  const text = `${sign}${grouped}${trimmedFrac ? `,${trimmedFrac}` : ''}`
  return unit ? `${text} ${unit}` : text
}

/** Long Indonesian date in the store timezone, e.g. "Selasa, 10 November 2026". */
export function formatStoreDate(date: Date, timeZone = STORE_TIMEZONE_DEFAULT): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(date)
}

/** Short date + time in the store timezone, e.g. "10 Nov 2026, 09.12". */
export function formatStoreDateTime(date: Date, timeZone = STORE_TIMEZONE_DEFAULT): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  })
    .format(date)
    .replace(/\u00a0/g, ' ')
}

/** Today's date (YYYY-MM-DD) in the store timezone, for date-range defaults. */
export function storeToday(now: Date, timeZone = STORE_TIMEZONE_DEFAULT): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Signed quantity with a real minus sign: "-3.000" → "−3", "20.000" → "+20". */
export function formatDelta(delta: string, unit?: string): string {
  const neg = delta.startsWith('-')
  return `${neg ? '−' : '+'}${formatQuantity(delta.replace(/^-/, ''), unit)}`
}

/** Short zone label shown next to times so users never guess the timezone. */
export function timezoneLabel(timeZone = STORE_TIMEZONE_DEFAULT): string {
  const labels: Record<string, string> = {
    'Asia/Jakarta': 'WIB',
    'Asia/Makassar': 'WITA',
    'Asia/Jayapura': 'WIT',
  }
  return labels[timeZone] ?? timeZone
}
