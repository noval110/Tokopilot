import { useQuery } from '@tanstack/react-query'
import { PackageSearch, Search } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatQuantity } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import { catalogApi, type Product } from '@/services/catalog'
import { StockBadge } from '@/features/products/StockStatus'

/**
 * Searchable product combobox (WAI-ARIA combobox pattern): type to search by
 * name or SKU, arrow keys to move, Enter to pick, Escape to close.
 */
export function ProductPicker({
  value,
  onChange,
  error,
  label = 'Produk',
}: {
  value: Product | null
  onChange: (p: Product | null) => void
  error?: string | undefined
  label?: string
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const q = useDebounced(query.trim(), 200)

  const results = useQuery({
    queryKey: ['products', 'picker', q],
    queryFn: () => catalogApi.products({ q, per_page: 8, status: 'active', sort: q ? 'name' : 'stock' }),
    enabled: open && !value,
  })
  const items = results.data?.data ?? []

  function pick(p: Product) {
    onChange(p)
    setOpen(false)
    setQuery('')
  }

  if (value) {
    return (
      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink-800">{label}</p>
        {/* Wraps instead of truncating: on narrow screens the full name matters more than one line. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm bg-white px-4 py-3 ring-1 ring-daun-600 ring-inset">
          <div className="min-w-0 flex-1 basis-44">
            <div className="line-clamp-2 font-semibold break-words text-ink-900">{value.name}</div>
            <div className="num mt-0.5 text-[0.75rem] text-text-muted">
              {value.sku ?? 'Tanpa SKU'} · stok {formatQuantity(value.current_stock, value.unit)}
            </div>
          </div>
          <StockBadge status={value.stock_status} />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-sm font-semibold text-daun-800 underline-offset-4 hover:underline"
          >
            Ganti
          </button>
        </div>
      </div>
    )
  }

  const listId = `${id}-list`
  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink-800">
        {label}
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${items[active].id}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          autoComplete="off"
          placeholder="Cari nama atau SKU…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter' && open && items[active]) {
              e.preventDefault()
              pick(items[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          className={cn(
            'h-11 w-full rounded-sm bg-white pr-3 pl-9 text-[0.9375rem] ring-1 ring-inset placeholder:text-text-subtle focus:ring-2 focus:outline-none',
            error ? 'ring-danger-600 focus:ring-danger-600' : 'ring-paper-300 hover:ring-paper-400 focus:ring-daun-600',
          )}
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[0.8125rem] font-medium text-danger-600">
          {error}
        </p>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Hasil pencarian produk"
          className="absolute z-30 mt-1.5 max-h-80 w-full overflow-y-auto rounded-sm bg-white py-1 shadow-lift ring-1 ring-paper-300"
        >
          {results.isPending && <li className="px-4 py-3 text-sm text-text-muted">Mencari…</li>}
          {results.isSuccess && items.length === 0 && (
            <li className="flex items-center gap-2 px-4 py-3 text-sm text-text-muted">
              <PackageSearch className="size-4" aria-hidden /> Tidak ada produk aktif yang cocok.
            </li>
          )}
          {items.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-3 px-4 py-2.5', i === active && 'bg-paper-100')}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink-900">{p.name}</div>
                <div className="num text-[0.6875rem] text-text-subtle">{p.sku ?? 'Tanpa SKU'}</div>
              </div>
              <span className="num shrink-0 text-[0.8125rem] text-text-muted">{formatQuantity(p.current_stock, p.unit)}</span>
              <StockBadge status={p.stock_status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
