import { useQuery } from '@tanstack/react-query'
import { BookOpenText, PackagePlus, SlidersHorizontal } from 'lucide-react'
import { useMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { ButtonLink } from '@/components/ui/Button'
import { inventoryApi, inventoryKeys } from '@/services/inventory'
import { LedgerList } from './LedgerList'

/** Per-product stock ledger shown on the product page (FR-INV-06). */
export function ProductHistory({ productId, active }: { productId: string; active: boolean }) {
  const { data: me } = useMe()
  const isOwner = me?.membership?.role === 'OWNER'
  const timezone = me?.membership?.store.timezone ?? 'Asia/Jakarta'
  const params = { product_id: productId, per_page: 10 }
  const history = useQuery({ queryKey: inventoryKeys.movements(params), queryFn: () => inventoryApi.movements(params) })

  return (
    <section aria-labelledby="riwayat-stok" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-text-subtle">Buku besar</p>
          <h2 id="riwayat-stok" className="mt-1 text-2xl font-bold">Riwayat stok</h2>
        </div>
        {isOwner && active && (
          <div className="flex gap-2">
            <ButtonLink to={`/inventory/adjustments?product_id=${productId}`} variant="secondary" size="sm">
              <SlidersHorizontal className="size-4" aria-hidden /> Sesuaikan
            </ButtonLink>
            <ButtonLink to={`/inventory/restock?product_id=${productId}`} size="sm">
              <PackagePlus className="size-4" aria-hidden /> Restock
            </ButtonLink>
          </div>
        )}
      </div>
      {history.isPending && <div role="status" className="h-40 animate-pulse rounded-md bg-paper-100 ring-1 ring-paper-300"><span className="sr-only">Memuat riwayat…</span></div>}
      {history.isError && <Alert tone="danger">Riwayat stok tidak dapat dimuat.</Alert>}
      {history.data && history.data.data.length === 0 && (
        <div className="flex items-center gap-3 rounded-md bg-paper-50 px-5 py-4 text-sm text-text-muted ring-1 ring-paper-300">
          <BookOpenText className="size-4" aria-hidden /> Belum ada mutasi. Produk ini dibuat dengan stok awal 0.
        </div>
      )}
      {history.data && history.data.data.length > 0 && (
        <div className="overflow-hidden rounded-md bg-white ring-1 ring-paper-300">
          <LedgerList movements={history.data.data} timezone={timezone} showProduct={false} />
          {history.data.meta.total > history.data.data.length && (
            <p className="border-t border-paper-200 px-5 py-3 text-[0.8125rem] text-text-muted">
              {history.data.data.length} mutasi terbaru dari {history.data.meta.total}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
