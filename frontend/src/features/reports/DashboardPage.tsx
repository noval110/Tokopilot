import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowRight, CircleSlash, Info, PackageCheck, ReceiptText } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router'
import { useMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { ButtonLink } from '@/components/ui/Button'
import { RollingNumber } from '@/components/ui/RollingNumber'
import { cn } from '@/lib/cn'
import { formatIDR, formatQuantity, formatStoreDateTime, timezoneLabel } from '@/lib/format'
import { formatPeriod } from '@/lib/period'
import { catalogApi } from '@/services/catalog'
import { reportKeys, reportsApi } from '@/services/reports'
import { StockBadge, StockGauge } from '@/features/products/StockStatus'
import { PeriodFilter } from './PeriodFilter'
import { SalesTrendChart } from './SalesTrendChart'
import { TopProductsList } from './TopProductsList'
import { usePeriod } from './usePeriod'

const delay = (s: number) => ({ '--d': `${s}s` }) as CSSProperties

function greeting(timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(new Date()))
  if (hour < 11) return 'Selamat pagi'
  if (hour < 15) return 'Selamat siang'
  if (hour < 19) return 'Selamat sore'
  return 'Selamat malam'
}

function Card({ title, aside, children, className, style }: { title: string; aside?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section aria-label={title} style={style} className={cn('animate-rise rounded-md border-2 border-ink-900 bg-white p-5 shadow-lift sm:p-6', className)}>
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b-2 border-dashed border-ink-900/15 pb-3">
        <h2 className="text-lg font-extrabold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

const tileBands = { daun: 'bg-daun-600', terpal: 'bg-terpal-600', cabe: 'bg-cabe-600' }

/** Stat tile: a small painted board — colour band, label, rolling figure, footnote. */
function Tile({ label, value, format, foot, band, tilt, style }: {
  label: string
  value: number | undefined
  format: (n: number) => string
  foot?: ReactNode
  band: keyof typeof tileBands
  tilt: string
  style?: CSSProperties
}) {
  return (
    // One element (valid dl > div > dt/dd): the entrance uses fill "backwards", so afterwards
    // the tilt and the hover straightening own the transform.
    <div style={{ ...style, ['--tilt' as string]: tilt }} className="animate-pop-in lift tilted relative overflow-hidden rounded-md border-2 border-ink-900 bg-white p-5 pt-6 shadow-lift">
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-2 border-b-2 border-ink-900', tileBands[band])} />
      <dt className="eyebrow text-text-muted">{label}</dt>
      <dd className="mt-2 text-[1.85rem] leading-none font-black tracking-tight text-ink-900">
        {value === undefined ? <span className="inline-block h-7 w-24 animate-pulse rounded-xs bg-paper-200" aria-label="Memuat" /> : <RollingNumber value={value} format={format} delayMs={250} />}
      </dd>
      {foot && <dd className="mt-2.5 text-[0.8125rem] text-text-muted">{foot}</dd>}
    </div>
  )
}

function GettingStarted() {
  const steps = [
    { title: 'Tambah produk', body: 'Nama, harga, dan stok awal.', to: '/products/new', tilt: '-1.5deg' },
    { title: 'Cek inventaris', body: 'Kulakan saat barang datang.', to: '/inventory', tilt: '1deg' },
    { title: 'Catat transaksi pertama', body: 'Kasir mengurangi stok otomatis.', to: '/sales/new', tilt: '-0.5deg' },
  ]
  return (
    <section aria-label="Mulai di sini" className="sign animate-rise relative bg-kunyit-300 p-6 sm:p-8">
      <p className="eyebrow text-ink-900">Langkah 3 dari 3</p>
      <h2 className="font-sign mt-2 text-[2rem] leading-tight font-normal tracking-normal">Buku tokomu siap diisi.</h2>
      <p className="mt-1 text-ink-800">Angka di dasbor muncul setelah ada produk dan transaksi. Tidak ada angka contoh di sini.</p>
      <ol className="mt-6 grid gap-5 md:grid-cols-3">
        {steps.map((st, i) => (
          <li key={st.title} className="animate-pop" style={delay(0.15 + i * 0.1)}>
            <Link to={st.to} className="lift tilted group relative flex h-full items-start gap-3 rounded-sm border-2 border-ink-900 bg-white p-4 shadow-lift" style={{ ['--tilt' as string]: st.tilt }}>
              <span aria-hidden className="tape -top-3 left-1/2 -translate-x-1/2" />
              <span className="font-sign text-3xl leading-none text-cabe-600" aria-hidden>{i + 1}</span>
              <div>
                <div className="font-bold text-ink-900"><span className="sr-only">{i + 1}. </span>{st.title}</div>
                <p className="mt-1 text-sm text-text-muted">{st.body}</p>
              </div>
              <ArrowRight className="ml-auto size-4 shrink-0 text-ink-900 transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function DashboardPage() {
  const { data: me } = useMe()
  const period = usePeriod()
  const { from, to } = period.range
  const params = { from, to }

  const dash = useQuery({ queryKey: reportKeys.dashboard(params), queryFn: () => reportsApi.dashboard(params), placeholderData: keepPreviousData })
  const trend = useQuery({ queryKey: reportKeys.trend(params), queryFn: () => reportsApi.trend(params), placeholderData: keepPreviousData })
  const top = useQuery({ queryKey: reportKeys.top(params), queryFn: () => reportsApi.topProducts({ ...params, limit: 5 }), placeholderData: keepPreviousData })
  const low = useQuery({
    queryKey: ['products', 'list', { stock_status: 'low', sort: 'stock', per_page: 5 }],
    queryFn: () => catalogApi.products({ stock_status: 'low', sort: 'stock', per_page: 5 }),
  })

  const d = dash.data
  const s = d?.sales
  const firstName = me?.user.name.split(' ')[0] ?? ''
  const stale = dash.isPlaceholderData || trend.isPlaceholderData

  return (
    <div className="space-y-7">
      <header className="flex items-start justify-between gap-4">
        <div className="animate-rise">
          <p className="eyebrow text-text-subtle">Ikhtisar · {me?.membership?.store.name}</p>
          <h1 className="relative mt-2 w-fit text-[2.3rem] leading-[1.1] sm:text-[3rem]">
            {greeting(period.timezone)}, {firstName}.
            <svg aria-hidden viewBox="0 0 300 20" preserveAspectRatio="none" className="pointer-events-none absolute -bottom-2 left-0 h-3 w-full text-kunyit-400">
              <path d="M4 12C70 5 150 4 210 9s70 4 86-1" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" className="animate-draw" style={{ ['--len' as string]: '320', ['--d' as string]: '0.35s' }} />
            </svg>
          </h1>
        </div>
        {/* The shop's hanging BUKA sign, swinging gently. Decorative. */}
        <div aria-hidden className="animate-drop -mt-8 hidden shrink-0 sm:block" style={delay(0.2)}>
          <div className="animate-swing flex flex-col items-center" style={{ ['--swing' as string]: '4deg' }}>
            <span className="h-8 w-0.5 bg-ink-900" />
            <span className="sign-sm bg-cabe-600 px-5 py-2"><span className="font-sign text-2xl text-white">Buka</span></span>
          </div>
        </div>
      </header>

      <PeriodFilter period={period} />

      {dash.isError && <Alert tone="danger" title="Dasbor tidak dapat dimuat">Coba muat ulang halaman. Fitur kasir dan stok tetap berjalan.</Alert>}

      {d && d.active_products === 0 && s?.transaction_count === 0 ? (
        <GettingStarted />
      ) : (
        <div className={cn('space-y-6 transition-opacity', stale && 'opacity-60')} aria-busy={dash.isFetching}>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-text-muted">
            <span className="font-semibold text-ink-800">{formatPeriod(from, to)}</span>
            {d && <span className="num">data per {formatStoreDateTime(new Date(d.period.generated_at), period.timezone)} {timezoneLabel(period.timezone)}</span>}
            {s && s.voided_count > 0 && (
              <span className="inline-flex items-center gap-1"><CircleSlash className="size-3.5" aria-hidden /> {s.voided_count} transaksi void ({formatIDR(s.voided_net_total)}) tidak dihitung</span>
            )}
          </p>

          {/* KPIs: exactly one hero figure (net sales); tiles carry the rest. */}
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="@container sign animate-pop relative bg-kunyit-300 p-5 text-ink-900 md:col-span-2 xl:col-span-1" style={{ ...delay(0.05), ['--tilt' as string]: '-1deg' }}>
              <dt className="eyebrow">Penjualan bersih</dt>
              {/* Sized to the card, not the viewport: "Rp 14.555.800" stays on one line at every width. */}
              <dd className="mt-3 text-[clamp(2rem,12cqw,3.1rem)] leading-none font-black tracking-tight">
                {s ? <RollingNumber value={s.net_sales} format={formatIDR} /> : <span className="inline-block h-10 w-48 animate-pulse rounded-xs bg-kunyit-200" aria-label="Memuat" />}
              </dd>
              {s && (
                <dd className="num mt-3 text-[0.8125rem] font-semibold text-ink-800">
                  {formatIDR(s.gross_sales)} kotor − {formatIDR(s.discount_total)} diskon
                </dd>
              )}
            </div>
            <Tile style={delay(0.12)} band="terpal" tilt="0.8deg" label="Transaksi" value={s?.transaction_count} format={(n) => n.toLocaleString('id-ID')} foot="Lunas saja; void tidak dihitung" />
            <Tile style={delay(0.19)} band="daun" tilt="-0.6deg" label="Rata-rata per transaksi" value={s?.avg_transaction_value} format={formatIDR} foot="Penjualan bersih ÷ transaksi" />
            <Tile style={delay(0.26)} band="cabe" tilt="0.5deg" label="Laba kotor (estimasi)" value={s?.gross_profit} format={formatIDR} foot="Bersih − HPP; belum termasuk biaya operasional" />
          </dl>

          <Card style={delay(0.3)} title="Penjualan bersih harian" aside={<span className="text-[0.75rem] text-text-subtle">per hari, zona {timezoneLabel(period.timezone)}</span>}>
            {trend.data ? <SalesTrendChart data={trend.data.data} title="Penjualan bersih harian" animate /> : <div className="h-60 animate-pulse rounded-sm bg-paper-100" />}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card style={delay(0.38)} title="Produk terlaris" aside={<Link to={`/reports?${new URLSearchParams(period.preset === 'custom' ? { range: 'custom', from, to } : period.preset === '7d' ? {} : { range: period.preset })}`} className="text-[0.8125rem] font-semibold text-daun-800 hover:underline">Laporan lengkap</Link>}>
              {top.data ? (
                <TopProductsList items={top.data.data} emptyText="Belum ada produk terjual pada periode ini." />
              ) : (
                <div className="h-40 animate-pulse rounded-sm bg-paper-100" />
              )}
              <p className="mt-4 flex items-start gap-1.5 text-[0.75rem] text-text-subtle"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />Diurutkan menurut penjualan per produk sebelum diskon transaksi.</p>
            </Card>

            <Card
              style={delay(0.44)}
              title="Stok perlu perhatian"
              aside={d && <span className="text-[0.75rem] text-text-subtle">{d.active_products} aktif · {d.low_stock_count} rendah · {d.out_of_stock_count} habis</span>}
            >
              {low.data && low.data.data.length === 0 && (
                <p className="flex items-center gap-2 rounded-sm bg-daun-50 px-4 py-5 text-sm text-daun-900 ring-1 ring-daun-200">
                  <PackageCheck className="size-4" aria-hidden /> Semua stok di atas batas minimum.
                </p>
              )}
              {low.data && low.data.data.length > 0 && (
                <ul className="divide-y divide-paper-200">
                  {low.data.data.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      <Link to={`/products/${p.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900 hover:underline">{p.name}</Link>
                      <span className="num text-[0.8125rem] text-text-muted">{formatQuantity(p.current_stock, p.unit)}</span>
                      <StockGauge current={p.current_stock} min={p.min_stock} status={p.stock_status} className="hidden w-16 sm:block" />
                      <StockBadge status={p.stock_status} />
                    </li>
                  ))}
                </ul>
              )}
              {!low.data && <div className="h-40 animate-pulse rounded-sm bg-paper-100" />}
              <div className="mt-4 flex gap-3">
                <ButtonLink to="/inventory" variant="secondary" size="sm">Inventaris</ButtonLink>
                <ButtonLink to="/sales" variant="ghost" size="sm"><ReceiptText className="size-4" aria-hidden /> Transaksi</ButtonLink>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
