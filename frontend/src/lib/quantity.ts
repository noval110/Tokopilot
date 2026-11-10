/**
 * Quantity input helpers. Users may type Indonesian decimals ("2,5"); the API
 * expects dot decimals ("2.5"). Validation mirrors the backend NUMERIC(14,3)
 * and per-unit scale rules — the API stays authoritative.
 */

export function normalizeQuantityInput(raw: string): string {
  return raw.trim().replace(',', '.')
}

export function quantityError(raw: string, scale: number, label: string): string | undefined {
  const v = normalizeQuantityInput(raw)
  if (v === '') return undefined
  const m = /^(\d{1,11})(?:\.(\d{1,3}))?$/.exec(v)
  if (!m) return `${label} harus angka ≥ 0.`
  const frac = (m[2] ?? '').replace(/0+$/, '')
  if (frac.length > scale) {
    return scale === 0
      ? `${label} harus bilangan bulat untuk satuan ini.`
      : `${label} maksimal ${scale} angka di belakang koma.`
  }
  return undefined
}

/** Compares two canonical NUMERIC strings without floating point. */
export function compareQuantity(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.')
  const [bi = '0', bf = ''] = b.split('.')
  const aw = ai.replace(/^0+/, '') || '0'
  const bw = bi.replace(/^0+/, '') || '0'
  if (aw.length !== bw.length) return aw.length < bw.length ? -1 : 1
  if (aw !== bw) return aw < bw ? -1 : 1
  const fa = af.padEnd(3, '0')
  const fb = bf.padEnd(3, '0')
  return fa === fb ? 0 : fa < fb ? -1 : 1
}

/**
 * Exact decimal addition for previews ("24.000" + "-3.5" → "20.500"), using
 * BigInt thousandths — never floats. The server's result remains authoritative.
 */
export function addQuantity(a: string, b: string): string {
  const toMilli = (s: string): bigint => {
    const neg = s.trim().startsWith('-')
    const [w = '0', f = ''] = s.trim().replace(/^[-+]/, '').split('.')
    const v = BigInt(w || '0') * 1000n + BigInt((f + '000').slice(0, 3))
    return neg ? -v : v
  }
  const m = toMilli(a) + toMilli(b)
  const neg = m < 0n
  const abs = neg ? -m : m
  return `${neg ? '-' : ''}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`
}

/**
 * Ratio for a purely visual stock gauge (0–1). Float is acceptable here because
 * it only sizes a bar; no number shown to the user comes from it.
 */
export function gaugeRatio(current: string, min: string): number {
  const c = Number(current)
  const m = Number(min)
  if (!(m > 0)) return c > 0 ? 1 : 0
  return Math.max(0, Math.min(1, c / (m * 2)))
}
