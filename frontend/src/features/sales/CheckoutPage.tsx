import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, Banknote, Ellipsis, Minus, PackageSearch, Plus, QrCode, ReceiptText, ScanLine, Search, Trash2, X } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Loader'
import { RupiahField } from '@/components/ui/RupiahField'
import { ApiError, fieldErrors } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatIDR, formatQuantity, formatStoreDateTime } from '@/lib/format'
import { cartSubtotal, lineTotal } from '@/lib/money'
import { compareQuantity, normalizeQuantityInput, quantityError } from '@/lib/quantity'
import { useDebounced } from '@/lib/useDebounced'
import { catalogApi, type Product } from '@/services/catalog'
import { PAYMENT_LABELS, type PaymentMethod, salesApi } from '@/services/sales'
import { StockBadge } from '@/features/products/StockStatus'
import { type CartLine, toPayload, useCart, useIdempotencyKey } from './cart'

const PAYMENTS: Array<{ value: PaymentMethod; Icon: typeof Banknote }> = [
  { value: 'CASH', Icon: Banknote },
  { value: 'TRANSFER', Icon: ArrowLeftRight },
  { value: 'QRIS', Icon: QrCode },
  { value: 'OTHER', Icon: Ellipsis },
]

type Shortage = { product_id: string; available: string; requested: string }

function Catalog({ onAdd, inCart }: { onAdd: (p: Product) => void; inCart: Set<string> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const q = useDebounced(query.trim(), 200)
  const products = useQuery({
    queryKey: ['products', 'catalog', q],
    queryFn: () => catalogApi.products({ q, status: 'active', sort: 'name', per_page: 30 }),
    placeholderData: keepPreviousData,
  })

  // "/" focuses search, like most POS and web apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Scanner-friendly: an exact SKU (or a single result) + Enter adds immediately.
  async function onEnter() {
    const term = query.trim()
    if (!term) return
    const res = await catalogApi.products({ q: term, status: 'active', per_page: 10 })
    const exact = res.data.find((p) => p.sku?.toUpperCase() === term.toUpperCase())
    const pick = exact ?? (res.data.length === 1 ? res.data[0] : undefined)
    if (pick && pick.stock_status !== 'OUT') {
      onAdd(pick)
      setQuery('')
    }
  }

  const items = products.data?.data ?? []
  return (
    <section aria-label="Katalog produk" className="min-w-0">
      <div className="relative">
        <label htmlFor="pos-search" className="sr-only">Cari produk atau pindai SKU</label>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-text-subtle" />
        <input
          id="pos-search"
          ref={inputRef}
          autoFocus
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void onEnter()
            }
          }}
          placeholder="Cari produk atau pindai SKU…"
          className="h-14 w-full rounded-md bg-white pr-14 pl-12 text-base shadow-paper ring-1 ring-paper-300 ring-inset placeholder:text-text-subtle focus:ring-2 focus:ring-daun-600 focus:outline-none"
        />
        <kbd className="num absolute top-1/2 right-4 hidden -translate-y-1/2 rounded-xs bg-paper-100 px-1.5 py-0.5 text-[0.6875rem] text-text-subtle ring-1 ring-paper-300 sm:block">/</kbd>
      </div>

      <div className={cn('mt-4 transition-opacity', products.isPlaceholderData && 'opacity-60')}>
        {products.isPending && (
          <div role="status" className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-md bg-paper-100" />)}
            <span className="sr-only">Memuat produk…</span>
          </div>
        )}
        {products.isError && <Alert tone="danger">Produk tidak dapat dimuat.</Alert>}
        {products.isSuccess && items.length === 0 && (
          <div className="flex items-center gap-3 rounded-md bg-paper-50 px-5 py-8 text-sm text-text-muted ring-1 ring-paper-300">
            <PackageSearch className="size-5" aria-hidden />
            {q ? `Tidak ada produk aktif untuk “${q}”.` : 'Belum ada produk aktif. Tambahkan produk di Katalog.'}
          </div>
        )}
        <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {items.map((p) => {
            const out = p.stock_status === 'OUT'
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={out}
                  onClick={() => onAdd(p)}
                  className={cn(
                    'group relative flex h-full w-full flex-col rounded-md bg-white p-3.5 text-left ring-1 ring-paper-300 transition-[box-shadow,transform] ring-inset',
                    out ? 'cursor-not-allowed opacity-55' : 'hover:shadow-paper hover:ring-daun-600 active:translate-y-px',
                    inCart.has(p.id) && 'ring-2 ring-daun-600',
                  )}
                >
                  {/* Name = visible text with a spoken verb in front (WCAG 2.5.3: voice users say what they see). */}
                  <span className="line-clamp-2 text-sm leading-snug font-semibold text-ink-900"><span className="sr-only">Masukkan</span>{' '}{p.name}</span>
                  <span className="num mt-0.5 text-[0.6875rem] text-text-subtle">{p.sku ?? 'Tanpa SKU'}</span>
                  <span className="mt-auto flex items-end justify-between gap-2 pt-3">
                    <span className="num text-[0.9375rem] font-bold text-ink-900">{formatIDR(p.selling_price)}</span>
                    {out ? <StockBadge status="OUT" /> : <span className="num text-[0.6875rem] text-text-muted">{formatQuantity(p.current_stock, p.unit)}</span>}
                  </span>
                  {!out && (
                    <span aria-hidden className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full bg-daun-700 text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <Plus className="size-3.5" />
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function CartRow({
  line,
  shortage,
  onQty,
  onStep,
  onRemove,
}: {
  line: CartLine
  shortage?: Shortage | undefined
  onQty: (q: string) => void
  onStep: (d: 1 | -1) => void
  onRemove: () => void
}) {
  const qErr = quantityError(line.quantity, line.unitScale, 'Jumlah')
  const q = normalizeQuantityInput(line.quantity)
  const overStock = !qErr && q !== '' && compareQuantity(q, line.stock) > 0
  return (
    <li className="py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[0.875rem] leading-snug font-semibold text-ink-900">{line.name}</div>
          <div className="num text-[0.6875rem] text-text-subtle">
            {formatIDR(line.unitPrice)} / {line.unit}
          </div>
        </div>
        <span className="num shrink-0 text-[0.875rem] font-semibold">{formatIDR(lineTotal(line.unitPrice, line.quantity))}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex items-center rounded-sm bg-white ring-1 ring-paper-300">
          <button type="button" onClick={() => onStep(-1)} className="grid size-8 place-items-center text-ink-700 hover:bg-paper-100" aria-label={`Kurangi 1 ${line.name}`}>
            <Minus className="size-3.5" />
          </button>
          <input
            value={line.quantity}
            onChange={(e) => onQty(e.target.value)}
            inputMode={line.unitScale > 0 ? 'decimal' : 'numeric'}
            aria-label={`Jumlah ${line.name}`}
            aria-invalid={qErr || overStock || shortage ? true : undefined}
            className="num h-8 w-14 border-x border-paper-300 bg-transparent text-center text-sm focus:outline-none"
          />
          <button type="button" onClick={() => onStep(1)} className="grid size-8 place-items-center text-ink-700 hover:bg-paper-100" aria-label={`Tambah 1 ${line.name}`}>
            <Plus className="size-3.5" />
          </button>
        </div>
        <span className="num text-[0.6875rem] text-text-subtle">{line.unit}</span>
        <button type="button" onClick={onRemove} className="ml-auto grid size-8 place-items-center rounded-sm text-text-subtle hover:bg-danger-50 hover:text-danger-600" aria-label={`Hapus ${line.name}`}>
          <Trash2 className="size-4" />
        </button>
      </div>
      {(qErr || overStock || shortage) && (
        <p className="mt-1.5 text-[0.75rem] font-medium text-danger-600">
          {qErr ?? (shortage ? `Stok tidak cukup. Tersedia ${formatQuantity(shortage.available, line.unit)}.` : `Melebihi stok terakhir yang terlihat (${formatQuantity(line.stock, line.unit)}).`)}
        </p>
      )}
    </li>
  )
}

export function CheckoutPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const store = me?.membership?.store
  const [cart, dispatch] = useCart(store?.id ?? 'none')
  const idem = useIdempotencyKey()
  const [now, setNow] = useState(() => new Date())
  const [showNotes, setShowNotes] = useState(Boolean(cart.notes))
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const subtotal = cartSubtotal(cart.lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })))
  const discount = cart.discount ?? 0
  const total = Math.max(0, subtotal - discount)
  const itemCount = cart.lines.length

  const checkout = useMutation({
    mutationFn: () => salesApi.checkout(toPayload(cart, idem.keyFor(cart))),
    onSuccess: (sale) => {
      idem.reset()
      dispatch({ type: 'clear' })
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      void qc.invalidateQueries({ queryKey: ['sales'] })
      qc.setQueryData(['sales', 'detail', sale.id], sale)
      navigate(`/sales/${sale.id}`, { state: { justCreated: true, previewSubtotal: subtotal } })
    },
  })

  const err = checkout.error
  const shortages: Shortage[] = err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' ? ((err.details?.['items'] as Shortage[] | undefined) ?? []) : []
  const fe = fieldErrors(err)

  function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError(null)
    if (itemCount === 0) return setLocalError('Keranjang masih kosong.')
    if (cart.lines.some((l) => quantityError(l.quantity, l.unitScale, 'x') || !normalizeQuantityInput(l.quantity) || /^0*(\.0*)?$/.test(normalizeQuantityInput(l.quantity))))
      return setLocalError('Periksa jumlah pada setiap baris.')
    if (discount > subtotal) return setLocalError('Diskon tidak boleh melebihi subtotal.')
    checkout.mutate()
  }

  const errorMessage =
    localError ??
    (err instanceof ApiError
      ? err.code === 'INSUFFICIENT_STOCK'
        ? 'Stok tidak mencukupi untuk baris yang ditandai. Tidak ada yang tersimpan.'
        : err.code === 'PRODUCT_ARCHIVED'
          ? `${String(err.details?.['product_name'] ?? 'Produk')} sudah diarsipkan. Hapus dari keranjang.`
          : err.code === 'NETWORK_ERROR'
            ? 'Koneksi terputus. Tekan simpan lagi, transaksi tidak akan tercatat dua kali.'
            : (fe['discount_amount'] ?? err.message)
      : err
        ? 'Terjadi kesalahan. Tekan simpan lagi, transaksi tidak akan tercatat dua kali.'
        : null)

  return (
    <div className="animate-rise">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-text-subtle">Operasional · Kasir</p>
          <h1 className="mt-2 text-[2rem] leading-none font-bold sm:text-[2.5rem]">Transaksi baru</h1>
        </div>
        <p className="flex items-center gap-2 text-[0.8125rem] text-text-muted">
          <ScanLine className="size-4" aria-hidden /> Harga final dihitung server dari data produk saat disimpan.
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 pb-24 lg:grid-cols-[minmax(0,1fr)_23rem] lg:pb-0">
        <Catalog onAdd={(p) => { checkout.reset(); dispatch({ type: 'add', product: p }) }} inCart={new Set(cart.lines.map((l) => l.productId))} />

        <form id="nota" onSubmit={submit} noValidate aria-label="Nota transaksi" className="lg:sticky lg:top-24 lg:self-start">
          <div className="receipt-edge rounded-t-md bg-paper-50 px-5 pt-5 shadow-lift ring-1 ring-paper-300">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-lg leading-tight font-bold">{store?.name}</div>
                <div className="num text-[0.6875rem] text-text-muted">
                  {store && formatStoreDateTime(now, store.timezone)} · {me?.user.name}
                </div>
              </div>
              <ReceiptText className="size-5 text-text-subtle" aria-hidden />
            </div>
            <div className="my-3 border-t border-dashed border-paper-300" />

            {itemCount === 0 ? (
              <p className="py-8 text-center text-sm text-text-muted">
                Keranjang kosong.
                <br />
                <span className="text-[0.8125rem]">Pilih produk atau pindai SKU.</span>
              </p>
            ) : (
              <ul className="-my-1 max-h-[42dvh] divide-y divide-dashed divide-paper-300 overflow-y-auto pr-1" aria-label="Isi keranjang">
                {cart.lines.map((l) => (
                  <CartRow
                    key={l.productId}
                    line={l}
                    shortage={shortages.find((s) => s.product_id === l.productId)}
                    onQty={(q) => { checkout.reset(); dispatch({ type: 'qty', productId: l.productId, quantity: q }) }}
                    onStep={(d) => { checkout.reset(); dispatch({ type: 'step', productId: l.productId, delta: d }) }}
                    onRemove={() => { checkout.reset(); dispatch({ type: 'remove', productId: l.productId }) }}
                  />
                ))}
              </ul>
            )}

            <div className="my-3 border-t border-dashed border-paper-300" />
            <div className="space-y-1.5 text-[0.8125rem]">
              <div className="flex items-baseline gap-2 text-text-muted">
                <span>Subtotal · {itemCount} baris</span><span aria-hidden className="leader" /><span className="num">{formatIDR(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex items-baseline gap-2 text-text-muted">
                  <span>Diskon</span><span aria-hidden className="leader" /><span className="num">−{formatIDR(discount)}</span>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="eyebrow text-text-muted">Total</span>
              <span className="font-display text-[2.25rem] leading-none font-extrabold tracking-tight" aria-live="polite">
                {formatIDR(total)}
              </span>
            </div>
          </div>

          <div className="mt-4 space-y-4 rounded-md bg-white p-5 ring-1 ring-paper-300">
            <RupiahField
              label="Diskon transaksi"
              value={cart.discount}
              onChange={(v) => { checkout.reset(); dispatch({ type: 'discount', value: v }) }}
              error={discount > subtotal ? 'Diskon melebihi subtotal.' : fe['discount_amount']}
            />
            <fieldset>
              <legend className="mb-1.5 text-sm font-semibold text-ink-800">Metode pembayaran</legend>
              <div role="radiogroup" aria-label="Metode pembayaran" className="grid grid-cols-4 gap-1.5">
                {PAYMENTS.map(({ value, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={cart.payment === value}
                    onClick={() => dispatch({ type: 'payment', value })}
                    className={cn(
                      'flex h-14 flex-col items-center justify-center gap-1 rounded-sm text-[0.75rem] font-semibold ring-1 ring-inset transition-colors',
                      cart.payment === value ? 'bg-daun-700 text-white ring-daun-700 shadow-(--shadow-glow)' : 'bg-white text-ink-700 ring-paper-300 hover:ring-paper-400',
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {PAYMENT_LABELS[value]}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[0.75rem] text-text-subtle">Hanya dicatat. TokoPilot tidak memproses pembayaran.</p>
            </fieldset>
            {showNotes ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="pos-notes" className="text-sm font-semibold text-ink-800">Catatan</label>
                  <button type="button" onClick={() => { setShowNotes(false); dispatch({ type: 'notes', value: '' }) }} className="text-text-subtle hover:text-ink-900" aria-label="Hapus catatan">
                    <X className="size-4" />
                  </button>
                </div>
                <input id="pos-notes" value={cart.notes} maxLength={500} onChange={(e) => dispatch({ type: 'notes', value: e.target.value })}
                  className="h-10 w-full rounded-sm bg-white px-3 text-sm ring-1 ring-paper-300 ring-inset focus:ring-2 focus:ring-daun-600 focus:outline-none" />
              </div>
            ) : (
              <button type="button" onClick={() => setShowNotes(true)} className="text-sm font-semibold text-daun-800 underline-offset-4 hover:underline">
                + Tambah catatan
              </button>
            )}

            {errorMessage && <Alert tone="danger">{errorMessage}</Alert>}

            <Button type="submit" size="lg" className="h-14 w-full text-base" disabled={checkout.isPending || itemCount === 0}>
              {checkout.isPending ? <Spinner /> : null}
              {checkout.isPending ? 'Menyimpan…' : `Simpan transaksi · ${formatIDR(total)}`}
            </Button>
            {itemCount > 0 && !checkout.isPending && (
              <button type="button" onClick={() => { idem.reset(); checkout.reset(); dispatch({ type: 'clear' }) }} className="w-full text-center text-[0.8125rem] text-text-muted hover:text-danger-600">
                Kosongkan keranjang
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Mobile: sticky total bar that jumps to the receipt. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-paper-300 bg-paper-50/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <a href="#nota" className="flex h-12 items-center justify-between rounded-full bg-daun-800 px-5 text-white shadow-lift">
          <span className="text-sm">{itemCount} baris</span>
          <span className="num font-bold">{formatIDR(total)}</span>
          <span className="text-sm font-semibold text-kunyit-200">Ke nota ↓</span>
        </a>
      </div>
    </div>
  )
}
