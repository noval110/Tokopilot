import { Table2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatIDR } from '@/lib/format'
import { formatDay, formatIDRCompact, niceTicks } from '@/lib/period'
import type { DailyPoint } from '@/services/reports'

const PLOT_H = 200

/**
 * Daily net sales as columns (single series → one hue, no legend; the card
 * title names it). Specs per the dataviz method: ≤24px columns with a 4px
 * rounded data-end square at the baseline, 2px gaps, solid hairline grid,
 * one direct label on the peak, hover AND keyboard-focus tooltip, and a table
 * view so no value is gated behind the tooltip.
 */
export function SalesTrendChart({ data, title, animate = false }: { data: DailyPoint[]; title: string; animate?: boolean }) {
  const [active, setActive] = useState<number | null>(null)
  const [focusIdx, setFocusIdx] = useState(Math.max(0, data.length - 1))
  const [showTable, setShowTable] = useState(false)
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const max = Math.max(0, ...data.map((d) => d.net_sales))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const peakIdx = max > 0 ? data.findIndex((d) => d.net_sales === max) : -1
  const labelEvery = Math.max(1, Math.ceil(data.length / 8))
  const empty = max === 0

  function move(to: number) {
    const i = Math.max(0, Math.min(data.length - 1, to))
    setFocusIdx(i)
    setActive(i)
    refs.current[i]?.focus()
  }

  return (
    <figure aria-label={title} className="relative">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setShowTable((s) => !s)}
          aria-pressed={showTable}
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[0.75rem] font-semibold text-text-muted hover:bg-paper-100 hover:text-ink-900"
        >
          <Table2 className="size-3.5" aria-hidden /> {showTable ? 'Lihat grafik' : 'Lihat tabel'}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-80 overflow-y-auto rounded-sm ring-1 ring-paper-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-paper-50">
              <tr className="eyebrow text-text-subtle">
                <th scope="col" className="px-4 py-2 font-semibold">Tanggal</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Penjualan bersih</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Transaksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-200">
              {data.map((d) => (
                <tr key={d.date}>
                  <td className="px-4 py-2 text-text-muted">{formatDay(d.date)}</td>
                  <td className="num px-4 py-2 text-right">{formatIDR(d.net_sales)}</td>
                  <td className="num px-4 py-2 text-right">{d.transaction_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2 pt-5">
          {/* pt-5 above: headroom so the peak label never rises into the header (Sprint 7 fix at 360px). */}
          {/* Y axis */}
          <div className="relative" style={{ height: PLOT_H }} aria-hidden>
            {ticks.map((t) => (
              <span key={t} className="num absolute right-0 -translate-y-1/2 text-[0.6875rem] text-text-subtle" style={{ bottom: `${(t / top) * 100}%` }}>
                {formatIDRCompact(t)}
              </span>
            ))}
          </div>

          {/* Plot */}
          <div className="relative" style={{ height: PLOT_H }} onMouseLeave={() => setActive(null)}>
            {ticks.map((t) => (
              <div key={t} aria-hidden className={cn('absolute inset-x-0 h-px', t === 0 ? 'bg-paper-300' : 'bg-paper-200')} style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
            <div role="list" aria-label={`${title}, ${data.length} hari`} className="absolute inset-0 flex items-end gap-[2px]">
              {data.map((d, i) => {
                const h = (d.net_sales / top) * 100
                const on = active === i
                return (
                  <div role="listitem" key={d.date} className="relative flex h-full min-w-0 flex-1 justify-center">
                    <button
                      ref={(el) => { refs.current[i] = el }}
                      type="button"
                      tabIndex={i === focusIdx ? 0 : -1}
                      aria-label={`${formatDay(d.date)}: ${formatIDR(d.net_sales)}, ${d.transaction_count} transaksi`}
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => { setActive(i); setFocusIdx(i) }}
                      onBlur={() => setActive(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1) }
                        else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1) }
                        else if (e.key === 'Home') { e.preventDefault(); move(0) }
                        else if (e.key === 'End') { e.preventDefault(); move(data.length - 1) }
                      }}
                      className="group flex h-full w-full items-end justify-center rounded-xs focus-visible:outline-offset-0"
                    >
                      {d.net_sales > 0 && (
                        <span
                          aria-hidden
                          className={cn('block w-[70%] max-w-6 rounded-t-[4px] transition-colors', on ? 'bg-daun-700' : 'bg-daun-600', animate && 'animate-grow')}
                          style={{ height: `max(${h}%, 2px)`, ...(animate ? { ['--d' as string]: `${0.35 + i * 0.025}s` } : {}) }}
                        />
                      )}
                    </button>
                    {i === peakIdx && !on && (
                      // One line, leaning into the plot: right-aligned on the right half, left-aligned on the left.
                      <span
                        aria-hidden
                        className={cn(
                          'num pointer-events-none absolute -translate-y-full pb-1 text-[0.6875rem] font-semibold whitespace-nowrap text-ink-800',
                          i >= data.length / 2 ? 'right-0' : 'left-0',
                        )}
                        style={{ bottom: `${h}%` }}
                      >
                        {formatIDRCompact(d.net_sales)}
                      </span>
                    )}
                    {on && (
                      // Anchored inside the plot, beside the column: never leaves the card or covers the bar.
                      <div
                        role="tooltip"
                        className={cn(
                          'pointer-events-none absolute top-1 z-10 w-max rounded-sm bg-ink-900 px-3 py-2 text-[0.75rem] text-paper-50 shadow-lift',
                          i >= data.length / 2 ? 'right-[calc(50%+16px)]' : 'left-[calc(50%+16px)]',
                        )}
                      >
                        <div className="font-semibold">{formatDay(d.date)}</div>
                        <div className="num mt-0.5">{formatIDR(d.net_sales)}</div>
                        <div className="text-ink-300">{d.transaction_count} transaksi</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {empty && (
              <div className="absolute inset-0 grid place-items-center">
                <p className="rounded-sm bg-white/90 px-3 py-1.5 text-sm text-text-muted ring-1 ring-paper-200">Belum ada penjualan pada periode ini.</p>
              </div>
            )}
          </div>

          {/* X axis */}
          <div aria-hidden />
          <div className="mt-2 flex gap-[2px]" aria-hidden>
            {data.map((d, i) => {
              const edge = i === 0 || i === data.length - 1
              // Regular labels too close to the last-day label are dropped so the two never touch.
              const shown = edge || (i % labelEvery === 0 && data.length - 1 - i >= labelEvery)
              // Narrow screens: only first/last labels so they never collide; the rest
              // stay reachable through the tooltip and the table view.
              return (
                <span
                  key={d.date}
                  className={cn(
                    'num min-w-0 flex-1 text-center text-[0.6875rem] whitespace-nowrap text-text-subtle',
                    !edge && 'invisible sm:visible',
                    i === 0 && 'text-left sm:text-center',
                    i === data.length - 1 && 'text-right sm:text-center',
                  )}
                >
                  {shown ? formatDay(d.date) : ''}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </figure>
  )
}
