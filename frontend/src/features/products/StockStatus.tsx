import { AlertTriangle, CheckCircle2, CircleSlash } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { formatQuantity } from '@/lib/format'
import { gaugeRatio } from '@/lib/quantity'
import type { StockStatus } from '@/services/catalog'

const meta: Record<StockStatus, { label: string; tone: 'positive' | 'warning' | 'danger'; Icon: typeof CheckCircle2; bar: string }> = {
  OK: { label: 'Aman', tone: 'positive', Icon: CheckCircle2, bar: 'bg-daun-600' },
  LOW: { label: 'Stok rendah', tone: 'warning', Icon: AlertTriangle, bar: 'bg-warn-600' },
  OUT: { label: 'Habis', tone: 'danger', Icon: CircleSlash, bar: 'bg-danger-600' },
}

/** Status label with icon + text — never colour alone (NFR-14). */
export function StockBadge({ status }: { status: StockStatus }) {
  const m = meta[status]
  return (
    <Badge tone={m.tone} icon={<m.Icon className="size-3" aria-hidden />}>
      {m.label}
    </Badge>
  )
}

/**
 * Compact level gauge: the tick marks the minimum stock (at the midpoint), so
 * "below the line" reads instantly. Purely visual; numbers come from the API.
 */
export function StockGauge({
  current,
  min,
  status,
  className,
}: {
  current: string
  min: string
  status: StockStatus
  className?: string
}) {
  const ratio = gaugeRatio(current, min)
  return (
    <div aria-hidden className={cn('relative h-1.5 w-20 overflow-hidden rounded-full bg-paper-200', className)}>
      <div className={cn('h-full rounded-full', meta[status].bar)} style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 6 : 0)}%` }} />
      <div className="absolute inset-y-0 left-1/2 w-px bg-ink-900/40" />
    </div>
  )
}

export function StockCell({
  current,
  min,
  unit,
  status,
}: {
  current: string
  min: string
  unit: string
  status: StockStatus
}) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="num text-[0.9375rem] font-semibold text-ink-900">{formatQuantity(current, unit)}</span>
      <div className="flex items-center gap-2">
        <StockGauge current={current} min={min} status={status} />
        <StockBadge status={status} />
      </div>
    </div>
  )
}
