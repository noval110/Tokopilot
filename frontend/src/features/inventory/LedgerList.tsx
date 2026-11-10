import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { formatDelta, formatQuantity, formatStoreDateTime } from '@/lib/format'
import { type Movement, MOVEMENT_LABELS, type MovementType, reasonLabel } from '@/services/inventory'

const typeTone: Record<MovementType, string> = {
  INITIAL: 'text-ink-700 ring-ink-300',
  RESTOCK: 'text-daun-800 ring-daun-300',
  ADJUSTMENT_IN: 'text-daun-800 ring-daun-300',
  ADJUSTMENT_OUT: 'text-warn-800 ring-warn-200',
  SALE: 'text-ink-800 ring-ink-300',
  SALE_VOID: 'text-ink-700 ring-ink-300',
}

/** Ledger entry type as a small stamp-like tag (text always present). */
export function MovementTag({ type }: { type: MovementType }) {
  return (
    <span className={cn('eyebrow inline-flex h-6 items-center rounded-xs px-2 text-[0.625rem] ring-1 ring-inset', typeTone[type])}>
      {MOVEMENT_LABELS[type]}
    </span>
  )
}

function Delta({ m }: { m: Movement }) {
  const out = m.quantity_delta.startsWith('-')
  return (
    <span className={cn('num shrink-0 font-semibold whitespace-nowrap', out ? 'text-ink-900' : 'text-daun-700')}>
      {formatDelta(m.quantity_delta, m.product.unit)}
    </span>
  )
}

function Note({ m }: { m: Movement }) {
  const reason = reasonLabel(m.reason_code)
  if (!reason && !m.note) return <span className="text-text-subtle">Tanpa catatan</span>
  return (
    <span className="text-text-muted">
      {reason && <span className="font-semibold text-ink-800">{reason}</span>}
      {reason && m.note && ' · '}
      {m.note}
    </span>
  )
}

/**
 * The stock ledger ("buku besar"): newest first, each row shows the signed
 * change and the running balance before → after. Rows are never edited.
 */
export function LedgerList({
  movements,
  timezone,
  showProduct = true,
}: {
  movements: Movement[]
  timezone: string
  showProduct?: boolean
}) {
  return (
    <>
      <table className="hidden w-full text-left text-sm md:table">
        <caption className="sr-only">Buku besar mutasi stok, terbaru di atas</caption>
        <thead className="border-b border-paper-300 bg-paper-50">
          <tr className="eyebrow text-text-subtle">
            <th scope="col" className="px-5 py-3 font-semibold">Waktu</th>
            {showProduct && <th scope="col" className="px-5 py-3 font-semibold">Produk</th>}
            <th scope="col" className="px-5 py-3 font-semibold">Jenis</th>
            <th scope="col" className="px-5 py-3 text-right font-semibold">Perubahan</th>
            <th scope="col" className="px-5 py-3 text-right font-semibold">Saldo</th>
            <th scope="col" className="px-5 py-3 font-semibold">Keterangan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-paper-200">
          {movements.map((m) => (
            <tr key={m.id} className="align-top">
              <td className="px-5 py-3.5">
                <div className="num text-[0.8125rem] whitespace-nowrap text-ink-800">{formatStoreDateTime(new Date(m.created_at), timezone)}</div>
                <div className="mt-0.5 text-[0.75rem] text-text-subtle">{m.actor.name}</div>
              </td>
              {showProduct && (
                <td className="px-5 py-3.5">
                  <Link to={`/products/${m.product.id}`} className="font-semibold text-ink-900 underline-offset-4 hover:underline">
                    {m.product.name}
                  </Link>
                  <div className="num mt-0.5 text-[0.75rem] text-text-subtle">{m.product.sku ?? 'Tanpa SKU'}</div>
                </td>
              )}
              <td className="px-5 py-3.5"><MovementTag type={m.type} /></td>
              <td className="px-5 py-3.5 text-right whitespace-nowrap"><Delta m={m} /></td>
              <td className="num px-5 py-3.5 text-right whitespace-nowrap text-text-muted">
                {formatQuantity(m.stock_before)} <span aria-label="menjadi">→</span>{' '}
                <span className="font-semibold text-ink-900">{formatQuantity(m.stock_after)}</span>
              </td>
              <td className="max-w-64 px-5 py-3.5 text-[0.8125rem]"><Note m={m} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <ol className="divide-y divide-paper-200 md:hidden">
        {movements.map((m) => (
          <li key={m.id} className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {showProduct && <div className="truncate font-semibold text-ink-900">{m.product.name}</div>}
                <div className="num text-[0.75rem] text-text-subtle">
                  {formatStoreDateTime(new Date(m.created_at), timezone)} · {m.actor.name}
                </div>
              </div>
              <Delta m={m} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <MovementTag type={m.type} />
              <span className="num text-[0.75rem] text-text-muted">
                {formatQuantity(m.stock_before)} → <span className="font-semibold text-ink-900">{formatQuantity(m.stock_after)}</span>
              </span>
            </div>
            {(m.reason_code || m.note) && <p className="mt-1.5 text-[0.8125rem]"><Note m={m} /></p>}
          </li>
        ))}
      </ol>
    </>
  )
}
