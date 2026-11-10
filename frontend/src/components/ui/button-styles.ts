import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'on-dark'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-sm border-2 font-bold whitespace-nowrap select-none ' +
  'disabled:pointer-events-none disabled:opacity-50'

// Solid variants are painted signs: ink outline + print shadow, and they press into the shadow on click.
const sign = 'press border-ink-900 shadow-(--shadow-glow)'

const variants: Record<ButtonVariant, string> = {
  primary: `${sign} bg-daun-700 text-white hover:bg-daun-800`,
  secondary: `${sign} bg-white text-ink-900 hover:bg-kunyit-50`,
  ghost: 'border-transparent text-ink-800 transition-colors hover:bg-paper-200/80 hover:text-ink-900',
  danger: `${sign} bg-danger-600 text-white hover:bg-danger-800`,
  // Low-emphasis entry point to a destructive flow (the confirm dialog holds the solid danger button).
  'danger-ghost': 'border-transparent text-danger-600 transition-colors hover:bg-danger-50 hover:text-danger-800',
  'on-dark': `${sign} bg-kunyit-300 text-ink-900 hover:bg-kunyit-200`,
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[0.8125rem]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-6 text-base',
}

export interface ButtonStyleProps {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function buttonClass({ variant = 'primary', size = 'md' }: ButtonStyleProps = {}, extra?: string) {
  return cn(base, variants[variant], sizes[size], extra)
}
