import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { timezoneLabel } from '@/lib/format'
import type { Preset } from '@/lib/period'
import type { PeriodState } from './usePeriod'

const PRESETS: Array<{ id: Exclude<Preset, 'custom'>; label: string }> = [
  { id: 'today', label: 'Hari ini' },
  { id: '7d', label: '7 hari' },
  { id: '30d', label: '30 hari' },
]

/** One filter row above everything it scopes (dataviz: filters never live inside a chart card). */
export function PeriodFilter({ period, actions }: { period: PeriodState; actions?: ReactNode }) {
  const dateInput = 'h-10 rounded-sm bg-white px-3 text-sm ring-1 ring-paper-300 ring-inset focus:ring-2 focus:ring-daun-600 focus:outline-none'
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div role="radiogroup" aria-label="Periode" className="inline-flex rounded-sm bg-paper-200/70 p-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={period.preset === p.id}
            onClick={() => period.set(p.id)}
            className={cn(
              'h-8 rounded-xs px-3 text-[0.8125rem] font-semibold transition-colors',
              period.preset === p.id ? 'bg-white text-ink-900 shadow-paper' : 'text-text-muted hover:text-ink-900',
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={period.preset === 'custom'}
          onClick={() => period.set('custom')}
          className={cn(
            'h-8 rounded-xs px-3 text-[0.8125rem] font-semibold transition-colors',
            period.preset === 'custom' ? 'bg-white text-ink-900 shadow-paper' : 'text-text-muted hover:text-ink-900',
          )}
        >
          Kustom
        </button>
      </div>
      {period.preset === 'custom' && (
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[0.75rem] font-semibold text-ink-800">Dari</span>
            <input type="date" value={period.range.from} max={period.today} onChange={(e) => e.target.value && period.set('custom', { from: e.target.value })} className={dateInput} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.75rem] font-semibold text-ink-800">Sampai</span>
            <input type="date" value={period.range.to} max={period.today} onChange={(e) => e.target.value && period.set('custom', { to: e.target.value })} className={dateInput} />
          </label>
        </div>
      )}
      <span className="eyebrow pb-2.5 text-[0.625rem] text-text-subtle">Zona {timezoneLabel(period.timezone)}</span>
      {actions && <div className="ml-auto">{actions}</div>}
    </div>
  )
}
