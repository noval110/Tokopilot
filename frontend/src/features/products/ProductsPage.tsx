import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Boxes, ChevronLeft, ChevronRight, FilterX, Plus, Search, Tags } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectField } from '@/components/ui/Select'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatIDR, formatQuantity } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import { useSearchParamsPatch } from '@/lib/useSearchParamsPatch'
import { catalogApi, catalogKeys, type ProductListParams } from '@/services/catalog'
import { PageHeader } from '@/features/settings/PageHeader'
import { CategoryManager } from './CategoryManager'
import { StockBadge, StockCell, StockGauge } from './StockStatus'

const PER_PAGE = 20
const stockTabs = [
  { value: '', label: 'Semua' },
  { value: 'low', label: 'Stok rendah' },
  { value: 'out', label: 'Habis' },
] as const

export function ProductsPage() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const isOwner = me?.membership?.role === 'OWNER'
  const { params, patch: update, reset } = useSearchParamsPatch()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const debouncedSearch = useDebounced(search, 300)
  const [managingCategories, setManagingCategories] = useState(false)

  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)
  const filters: ProductListParams = {
    q: params.get('q') ?? '',
    category_id: params.get('category_id') ?? '',
    stock_status: (params.get('stock_status') ?? '') as ProductListParams['stock_status'],
    status: (params.get('status') ?? '') as ProductListParams['status'],
    sort: (params.get('sort') ?? '') as ProductListParams['sort'],
    page,
    per_page: PER_PAGE,
  }


  useEffect(() => {
    if (debouncedSearch.trim() !== (params.get('q') ?? '')) update({ q: debouncedSearch.trim() })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [debouncedSearch])

  const products = useQuery({
    queryKey: catalogKeys.products(filters),
    queryFn: () => catalogApi.products(filters),
    placeholderData: keepPreviousData,
  })
  const categories = useQuery({ queryKey: catalogKeys.categories, queryFn: () => catalogApi.categories() })

  const filtered = Boolean(filters.q || filters.category_id || filters.stock_status || filters.status === 'archived')
  const data = products.data
  const total = data?.meta.total ?? 0
  const from = total === 0 ? 0 : (page - 1) * PER_PAGE + 1
  const to = Math.min(total, page * PER_PAGE)

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Katalog"
        title="Produk"
        actions={
          isOwner && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setManagingCategories(true)}>
                <Tags className="size-4" aria-hidden /> Kategori
              </Button>
              <ButtonLink to="/products/new">
                <Plus className="size-4" aria-hidden /> Tambah produk
              </ButtonLink>
            </div>
          )
        }
      >
        {isOwner ? 'Kelola katalog, harga, dan stok minimum.' : 'Lihat produk, harga, dan stok. Perubahan katalog dilakukan oleh owner.'}
      </PageHeader>

      {/* Filters */}
      <div className="mt-6 space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="relative flex-1">
            <label htmlFor="product-search" className="sr-only">
              Cari nama atau SKU
            </label>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
            <input
              id="product-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau SKU…"
              maxLength={100}
              className="h-11 w-full rounded-sm bg-white pr-3 pl-9 text-[0.9375rem] ring-1 ring-paper-300 ring-inset placeholder:text-text-subtle hover:ring-paper-400 focus:ring-2 focus:ring-daun-600 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:flex md:w-auto">
            <SelectField hideLabel label="Kategori" value={filters.category_id} onChange={(e) => update({ category_id: e.target.value })} className="col-span-2 md:w-44">
              <option value="">Semua kategori</option>
              {categories.data?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <SelectField hideLabel label="Status produk" value={filters.status} onChange={(e) => update({ status: e.target.value })} className="md:w-36">
              <option value="">Aktif</option>
              <option value="archived">Diarsipkan</option>
            </SelectField>
            <SelectField hideLabel label="Urutkan" value={filters.sort} onChange={(e) => update({ sort: e.target.value })} className="md:w-44">
              <option value="">Nama A–Z</option>
              <option value="-updated_at">Terakhir diubah</option>
              <option value="stock">Stok terendah</option>
            </SelectField>
          </div>
        </div>
        <div role="radiogroup" aria-label="Filter status stok" className="inline-flex rounded-sm bg-paper-200/70 p-1">
          {stockTabs.map((t) => {
            const active = (filters.stock_status ?? '') === t.value
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update({ stock_status: t.value })}
                className={cn(
                  'h-8 rounded-xs px-3 text-[0.8125rem] font-semibold transition-colors',
                  active ? 'bg-white text-ink-900 shadow-paper' : 'text-text-muted hover:text-ink-900',
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Results */}
      <section aria-label="Daftar produk" aria-busy={products.isFetching} className="mt-5">
        {products.isPending && (
          <div role="status" className="overflow-hidden rounded-md bg-white ring-1 ring-paper-300">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-[4.25rem] animate-pulse border-b border-paper-200 bg-paper-100/60 last:border-0" />
            ))}
            <span className="sr-only">Memuat produk…</span>
          </div>
        )}

        {products.isError && (
          <Alert tone="danger" title="Produk tidak dapat dimuat">
            {products.error instanceof ApiError ? products.error.message : 'Coba muat ulang halaman.'}
          </Alert>
        )}

        {data && total === 0 && !filtered && (
          <EmptyState
            icon={<Boxes className="size-5" aria-hidden />}
            title="Katalog masih kosong"
            action={isOwner && <ButtonLink to="/products/new"><Plus className="size-4" aria-hidden /> Tambah produk pertama</ButtonLink>}
          >
            {isOwner ? 'Mulai dengan produk yang paling sering terjual.' : 'Owner belum menambahkan produk.'}
          </EmptyState>
        )}

        {data && total === 0 && filtered && (
          <EmptyState
            icon={<FilterX className="size-5" aria-hidden />}
            title="Tidak ada produk yang cocok"
            action={
              <Button variant="secondary" onClick={() => { setSearch(''); reset() }}>
                Hapus semua filter
              </Button>
            }
          >
            Coba kata kunci lain atau longgarkan filter.
          </EmptyState>
        )}

        {data && total > 0 && (
          <div className={cn('overflow-hidden rounded-md bg-white ring-1 ring-paper-300 transition-opacity', products.isPlaceholderData && 'opacity-60')}>
            {/* Desktop table */}
            <table className="hidden w-full text-left text-sm md:table">
              <caption className="sr-only">Produk {filters.status === 'archived' ? 'diarsipkan' : 'aktif'}</caption>
              <thead className="border-b border-paper-300 bg-paper-50">
                <tr className="eyebrow text-text-subtle">
                  <th scope="col" className="px-5 py-3 font-semibold">Produk</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Kategori</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Harga jual</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Stok</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Min.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-200">
                {data.data.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/products/${p.id}`)}
                    className="cursor-pointer transition-colors hover:bg-paper-50"
                  >
                    <td className="px-5 py-3.5">
                      <Link
                        to={`/products/${p.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-semibold text-ink-900 underline-offset-4 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="num mt-0.5 text-[0.75rem] text-text-subtle">{p.sku ?? 'Tanpa SKU'}</div>
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">{p.category?.name ?? 'Tanpa kategori'}</td>
                    <td className="num px-5 py-3.5 text-right font-semibold text-ink-900">{formatIDR(p.selling_price)}</td>
                    <td className="px-5 py-3">
                      {p.is_active ? (
                        <StockCell current={p.current_stock} min={p.min_stock} unit={p.unit} status={p.stock_status} />
                      ) : (
                        <div className="flex justify-end"><Badge>Diarsipkan</Badge></div>
                      )}
                    </td>
                    <td className="num px-5 py-3.5 text-right text-text-muted">{formatQuantity(p.min_stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <ul className="divide-y divide-paper-200 md:hidden">
              {data.data.map((p) => (
                <li key={p.id}>
                  <Link to={`/products/${p.id}`} className="flex items-start justify-between gap-4 px-4 py-3.5 active:bg-paper-50">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink-900">{p.name}</div>
                      <div className="num mt-0.5 text-[0.75rem] text-text-subtle">
                        {p.sku ?? 'Tanpa SKU'} · {p.category?.name ?? 'Tanpa kategori'}
                      </div>
                      <div className="num mt-1.5 text-sm font-semibold text-ink-900">{formatIDR(p.selling_price)}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="num text-sm font-semibold">{formatQuantity(p.current_stock, p.unit)}</span>
                      {p.is_active ? (
                        <>
                          <StockGauge current={p.current_stock} min={p.min_stock} status={p.stock_status} className="w-16" />
                          <StockBadge status={p.stock_status} />
                        </>
                      ) : (
                        <Badge>Diarsipkan</Badge>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            <nav aria-label="Halaman produk" className="flex items-center justify-between border-t border-paper-200 px-5 py-3">
              <p className="num text-[0.75rem] text-text-muted">
                {from}–{to} dari {total}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)} aria-label="Halaman sebelumnya">
                  <ChevronLeft className="size-4" />
                </Button>
                <Button variant="secondary" size="sm" disabled={to >= total} onClick={() => update({ page: String(page + 1) }, false)} aria-label="Halaman berikutnya">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </nav>
          </div>
        )}
      </section>

      {isOwner && <CategoryManager open={managingCategories} onClose={() => setManagingCategories(false)} />}
    </div>
  )
}
