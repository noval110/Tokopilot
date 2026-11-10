import { cn } from '@/lib/cn'

const group = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

/**
 * Live shelf-label preview ("label rak"). Shows how the product reads to a
 * customer: name, price per unit, SKU. A preview only — not a print layout.
 */
export function PriceTag({
  name,
  price,
  unit,
  sku,
  category,
  className,
}: {
  name: string
  price: number | null
  unit: string
  sku: string
  category?: string | undefined
  className?: string
}) {
  return (
    <figure aria-label="Pratinjau label rak" className={cn('w-full max-w-[17rem]', className)}>
      <figcaption className="eyebrow mb-3 text-text-muted">Pratinjau label rak</figcaption>
      <div className="relative rotate-[-1.5deg] overflow-hidden rounded-sm bg-white shadow-lift ring-1 ring-paper-300">
        <div className="flex items-center justify-between bg-daun-700 px-4 py-2">
          <span className="eyebrow truncate text-[0.625rem] text-kunyit-100">{category || 'Tanpa kategori'}</span>
          <span aria-hidden className="size-3 shrink-0 rounded-full bg-paper-50 ring-2 ring-daun-800" />
        </div>
        <div className="px-4 pt-3 pb-4">
          <p className="font-display text-[1.0625rem] leading-tight font-bold break-words text-ink-900">
            {name.trim() || <span className="text-text-subtle">Nama produk</span>}
          </p>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="num text-sm font-semibold text-text-muted">Rp</span>
            <span className="font-display text-[2.25rem] leading-none font-extrabold tracking-tight text-ink-900">
              {price === null ? <span className="text-text-subtle">0</span> : group.format(price)}
            </span>
            <span className="num text-sm text-text-muted">/{unit.trim() || 'satuan'}</span>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-dashed border-paper-300 pt-2.5">
            <span className="num text-[0.6875rem] text-text-subtle">{sku.trim().toUpperCase() || 'TANPA SKU'}</span>
            <span aria-hidden className="h-2 w-8 rounded-full bg-daun-500" />
          </div>
        </div>
      </div>
    </figure>
  )
}
