import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, Info } from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { buttonClass } from '@/components/ui/button-styles'
import { ApiError, fieldErrors } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatIDR, formatStoreDateTime, timezoneLabel } from '@/lib/format'
import { formatPeriod } from '@/lib/period'
import { reportKeys, reportsApi, type SalesSummary } from '@/services/reports'
import { PAYMENT_LABELS } from '@/services/sales'
import { PageHeader } from '@/features/settings/PageHeader'
import { PeriodFilter } from './PeriodFilter'
import { SalesTrendChart } from './SalesTrendChart'
import { TopProductsList } from './TopProductsList'
import { usePeriod } from './usePeriod'

function StatementRow({ op, label, value, strong, hint }: { op?: string; label: string; value: number; strong?: boolean; hint?: string }) {
  return (
    <div className={cn('flex items-baseline gap-3 py-2.5', strong && 'border-t-2 border-double border-ink-900 font-bold')}>
      <span className="num w-4 shrink-0 text-text-subtle">{op}</span>
      <span className={cn('text-sm', strong ? 'text-ink-900' : 'text-ink-800')}>
        {label}
        {hint && <span className="block text-[0.75rem] font-normal text-text-subtle">{hint}</span>}
      </span>
      <span aria-hidden className="leader" />
      <span className={cn('num shrink-0', strong ? 'text-base' : 'text-sm')}>{op === '−' ? `−${formatIDR(value)}` : formatIDR(value)}</span>
    </div>
  )
}

/** A miniature income statement read top-to-bottom like a ledger page. */
function Statement({ s }: { s: SalesSummary }) {
  const margin = s.net_sales > 0 ? Math.round((s.gross_profit * 1000) / s.net_sales) / 10 : null
  return (
    <div>
      <StatementRow label="Penjualan kotor" value={s.gross_sales} hint="Σ subtotal transaksi lunas" />
      <StatementRow op="−" label="Diskon transaksi" value={s.discount_total} />
      <StatementRow op="=" label="Penjualan bersih" value={s.net_sales} strong />
      <StatementRow op="−" label="HPP (harga pokok)" value={s.cogs} hint="Σ harga modal saat transaksi × jumlah" />
      <StatementRow op="=" label="Laba kotor (estimasi)" value={s.gross_profit} strong />
      <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-sm bg-paper-200 text-center ring-1 ring-paper-200">
        {[
          ['Transaksi', s.transaction_count.toLocaleString('id-ID')],
          ['Rata-rata', formatIDR(s.avg_transaction_value)],
          ['Margin kotor', margin === null ? 'Belum ada' : `${margin.toLocaleString('id-ID')}%`],
        ].map(([k, v]) => (
          <div key={k} className="bg-paper-50 px-2 py-3">
            <dt className="text-[0.6875rem] text-text-muted">{k}</dt>
            <dd className="mt-1 text-sm font-semibold text-ink-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function ReportsPage() {
  const period = usePeriod()
  const params = { from: period.range.from, to: period.range.to }
  const report = useQuery({ queryKey: reportKeys.sales(params), queryFn: () => reportsApi.sales(params), placeholderData: keepPreviousData })
  const r = report.data
  const fe = fieldErrors(report.error)
  const totalPay = r?.payment_methods.reduce((a, p) => a + p.net_sales, 0) ?? 0

  return (
    <div className="animate-rise space-y-6">
      <PageHeader eyebrow="Wawasan" title="Laporan penjualan">
        Semua angka dihitung server dari transaksi lunas; transaksi void tidak dihitung.
      </PageHeader>

      <PeriodFilter
        period={period}
        actions={
          <a href={reportsApi.exportUrl(params)} download className={buttonClass({ variant: 'secondary', size: 'md' })}>
            <Download className="size-4" aria-hidden /> Unduh CSV
          </a>
        }
      />

      {report.isError && (
        <Alert tone="danger" title="Laporan tidak dapat dimuat">
          {fe['to'] ?? fe['from'] ?? (report.error instanceof ApiError ? report.error.message : 'Coba muat ulang halaman.')}
        </Alert>
      )}
      {report.isPending && <div role="status" className="h-96 animate-pulse rounded-md bg-paper-100"><span className="sr-only">Memuat laporan…</span></div>}

      {r && (
        <div className={cn('space-y-6 transition-opacity', report.isPlaceholderData && 'opacity-60')}>
          <p className="text-[0.8125rem] text-text-muted">
            <span className="font-semibold text-ink-800">{formatPeriod(r.period.from, r.period.to)}</span> · {r.period.days} hari · zona {timezoneLabel(r.period.timezone)} ·{' '}
            <span className="num">data per {formatStoreDateTime(new Date(r.period.generated_at), r.period.timezone)}</span>
          </p>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <section aria-label="Ringkasan" className="rounded-md bg-white p-6 ring-1 ring-paper-300">
              <h2 className="text-lg font-bold">Ringkasan</h2>
              <div className="mt-3"><Statement s={r.summary} /></div>
              {r.summary.voided_count > 0 && (
                <p className="mt-4 text-[0.8125rem] text-text-muted">
                  {r.summary.voided_count} transaksi void senilai {formatIDR(r.summary.voided_net_total)} dikecualikan.
                </p>
              )}
              <p className="mt-4 flex items-start gap-1.5 text-[0.75rem] text-text-subtle">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Estimasi margin produk; belum memperhitungkan biaya operasional dan pajak. Bukan laporan akuntansi atau pajak resmi.
              </p>
            </section>

            <section aria-label="Metode pembayaran" className="rounded-md bg-white p-6 ring-1 ring-paper-300">
              <h2 className="text-lg font-bold">Metode pembayaran</h2>
              {r.payment_methods.length === 0 ? (
                <p className="mt-4 text-sm text-text-muted">Belum ada transaksi lunas pada periode ini.</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <caption className="sr-only">Penjualan bersih per metode pembayaran</caption>
                  <thead>
                    <tr className="eyebrow text-left text-text-subtle">
                      <th scope="col" className="py-2 font-semibold">Metode</th>
                      <th scope="col" className="py-2 text-right font-semibold">Nota</th>
                      <th scope="col" className="py-2 text-right font-semibold">Bersih</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-paper-200">
                    {r.payment_methods.map((p) => (
                      <tr key={p.payment_method}>
                        <td className="py-3">
                          <div className="font-semibold text-ink-900">{PAYMENT_LABELS[p.payment_method]}</div>
                          <div className="mt-1.5 h-1.5 w-full max-w-40 overflow-hidden rounded-r-[4px] bg-paper-100" aria-hidden>
                            <div className="h-full rounded-r-[4px] bg-daun-600" style={{ width: `${totalPay ? (p.net_sales / totalPay) * 100 : 0}%` }} />
                          </div>
                        </td>
                        <td className="num py-3 text-right text-text-muted">{p.transaction_count}</td>
                        <td className="num py-3 text-right font-semibold">{formatIDR(p.net_sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <section aria-label="Penjualan bersih harian" className="rounded-md bg-white p-6 ring-1 ring-paper-300">
            <h2 className="text-lg font-bold">Penjualan bersih harian</h2>
            <div className="mt-2"><SalesTrendChart data={r.daily} title="Penjualan bersih harian" /></div>
          </section>

          <section aria-label="10 produk terlaris" className="rounded-md bg-white p-6 ring-1 ring-paper-300">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold">10 produk terlaris</h2>
              <span className="text-[0.75rem] text-text-subtle">penjualan per produk, sebelum diskon transaksi</span>
            </div>
            <TopProductsList items={r.top_products} emptyText="Belum ada produk terjual pada periode ini." />
          </section>
        </div>
      )}
    </div>
  )
}
