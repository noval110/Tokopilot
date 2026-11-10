import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatDelta, formatQuantity } from '@/lib/format'
import { addQuantity, normalizeQuantityInput, quantityError } from '@/lib/quantity'
import type { Product } from '@/services/catalog'

/**
 * Before → after preview of a stock change. Display only: the server computes
 * the real result under a row lock and may reject it.
 */
export function StockPreview({ product, quantity, direction }: { product: Product | null; quantity: string; direction: 'IN' | 'OUT' }) {
  const valid = product && quantity.trim() !== '' && !quantityError(quantity, product.unit_scale, 'x')
  const delta = valid ? (direction === 'OUT' ? '-' : '') + normalizeQuantityInput(quantity) : null
  const after = product && delta ? addQuantity(product.current_stock, delta) : null
  const negative = after?.startsWith('-') ?? false

  return (
    <figure
      aria-label="Pratinjau perubahan stok"
      className={cn(
        'ledger-lines rounded-md p-5 ring-1',
        negative ? 'bg-danger-50 ring-danger-200' : 'bg-paper-50 ring-paper-300',
      )}
    >
      <figcaption className="eyebrow text-text-subtle">Pratinjau buku besar</figcaption>
      {!product ? (
        <p className="mt-4 text-sm text-text-muted">Pilih produk untuk melihat saldo stok.</p>
      ) : (
        <>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <div className="text-[0.75rem] text-text-muted">Sekarang</div>
              <div className="font-display text-3xl font-bold text-ink-900">{formatQuantity(product.current_stock)}</div>
            </div>
            <div className="flex flex-col items-center pb-1.5">
              <span className={cn('num text-sm font-semibold', direction === 'OUT' ? 'text-ink-900' : 'text-daun-700')}>
                {delta ? formatDelta(delta) : direction === 'OUT' ? '−?' : '+?'}
              </span>
              <ArrowRight className="size-4 text-text-subtle" aria-hidden />
            </div>
            <div className="text-right">
              <div className="text-[0.75rem] text-text-muted">Setelah</div>
              <div className={cn('font-display text-3xl font-bold', negative ? 'text-danger-600' : after ? 'text-daun-800' : 'text-text-subtle')}>
                {after ? (negative ? `−${formatQuantity(after.slice(1))}` : formatQuantity(after)) : '?'}
              </div>
            </div>
          </div>
          <p className="num mt-3 text-[0.75rem] text-text-subtle">satuan: {product.unit}</p>
          {negative && (
            <p role="alert" className="mt-3 text-sm font-semibold text-danger-800">
              Stok tidak cukup. Tersedia {formatQuantity(product.current_stock, product.unit)}.
            </p>
          )}
        </>
      )}
    </figure>
  )
}
