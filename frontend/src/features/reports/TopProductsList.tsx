import { Link } from 'react-router'
import { formatIDR, formatQuantity } from '@/lib/format'
import type { TopProduct } from '@/services/reports'

/**
 * Ranked bars (single series, one hue). Each row prints its value at the bar
 * tip — this list doubles as its own table view, so nothing hides in a tooltip.
 */
export function TopProductsList({ items, emptyText }: { items: TopProduct[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="rounded-sm bg-paper-50 px-4 py-6 text-center text-sm text-text-muted ring-1 ring-paper-200">{emptyText}</p>
  }
  const max = Math.max(...items.map((i) => i.revenue), 1)
  return (
    <ol className="space-y-3.5" aria-label="Produk terlaris berdasarkan penjualan">
      {items.map((p) => (
        <li key={p.product_id ?? p.product_name} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
          <span className="num pt-0.5 text-sm font-semibold text-text-subtle">{String(p.rank).padStart(2, '0')}</span>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              {p.product_id ? (
                <Link to={`/products/${p.product_id}`} className="truncate text-sm font-semibold text-ink-900 underline-offset-4 hover:underline">{p.product_name}</Link>
              ) : (
                <span className="truncate text-sm font-semibold text-ink-900">{p.product_name}</span>
              )}
              <span className="num shrink-0 text-sm font-semibold text-ink-900">{formatIDR(p.revenue)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-r-[4px] bg-paper-100" aria-hidden>
                <div className="h-full rounded-r-[4px] bg-daun-600" style={{ width: `${Math.max((p.revenue / max) * 100, 2)}%` }} />
              </div>
              <span className="num shrink-0 text-[0.6875rem] text-text-muted">
                {formatQuantity(p.quantity_sold, p.unit)} · {p.transaction_count} nota
              </span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
