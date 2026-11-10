/**
 * Cart preview maths. Mirrors the backend exactly — round_half_up(price × qty)
 * in whole rupiah using BigInt thousandths — so the preview matches the
 * receipt. The server still recomputes everything from database prices.
 */

export function lineTotal(unitPrice: number, quantity: string): number {
  const q = quantity.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,3})?$/.test(q)) return 0
  const [w = '0', f = ''] = q.split('.')
  const milli = BigInt(w) * 1000n + BigInt((f + '000').slice(0, 3))
  const v = (BigInt(unitPrice) * milli + 500n) / 1000n
  return Number(v)
}

export function cartSubtotal(lines: Array<{ unitPrice: number; quantity: string }>): number {
  return lines.reduce((sum, l) => sum + lineTotal(l.unitPrice, l.quantity), 0)
}
