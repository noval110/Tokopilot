import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'positive' | 'warning' | 'danger' | 'ink'

const tones: Record<Tone, string> = {
  neutral: 'bg-paper-100 text-ink-700 ring-paper-300',
  positive: 'bg-daun-50 text-daun-800 ring-daun-200',
  warning: 'bg-warn-50 text-warn-800 ring-warn-200',
  danger: 'bg-danger-50 text-danger-800 ring-danger-200',
  ink: 'bg-ink-900 text-paper-100 ring-ink-700',
}

/** Small status label. Always pass text — colour alone never carries meaning. */
export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-xs px-2 text-xs font-bold ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

const stampTones: Record<'positive' | 'danger' | 'warning' | 'ink', string> = {
  positive: 'text-daun-700',
  danger: 'text-danger-600',
  warning: 'text-warn-600',
  ink: 'text-ink-700',
}

/** Rubber-stamp marker for document states such as LUNAS or VOID. */
export function Stamp({
  tone = 'positive',
  tilt = -4,
  children,
  className,
}: {
  tone?: keyof typeof stampTones
  tilt?: number
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn('stamp text-xs', stampTones[tone], className)}
      style={{ ['--stamp-tilt' as string]: `${tilt}deg` }}
    >
      {children}
    </span>
  )
}
