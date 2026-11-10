import { cn } from '@/lib/cn'

/**
 * The mark: a tiny shopfront sign — striped chilli-red awning with a scalloped
 * edge over a turmeric board, and the pilot's arrowhead painted in ink.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect x="1" y="1" width="30" height="30" rx="6" fill="#FFC629" stroke="#1D1712" strokeWidth="2" />
      <path d="M2 2h28v7H2Z" fill="#FFF8EC" />
      <path d="M2 2h5.6v7H2Zm11.2 0h5.6v7h-5.6Zm11.2 0H30v7h-5.6Z" fill="#D7261E" />
      <path
        d="M2 9a2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.6 0A2.8 2.8 0 0 0 30 9"
        fill="#FFF8EC"
        stroke="#1D1712"
        strokeWidth="1.6"
      />
      <path d="M16 14.5 22 26l-6-3.4L10 26Z" fill="#1D1712" />
      <rect x="1" y="1" width="30" height="30" rx="6" fill="none" stroke="#1D1712" strokeWidth="2" />
    </svg>
  )
}

export function Logo({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  return (
    <span className={cn('group inline-flex items-center gap-2.5', className)}>
      <LogoMark className="size-9 transition-transform duration-300 ease-(--ease-spring) group-hover:-rotate-6" />
      <span
        className={cn('font-sign painted text-[1.45rem] leading-none', tone === 'light' ? 'text-white' : 'text-ink-900')}
        style={{ ['--paint' as string]: tone === 'light' ? 'var(--color-ink-900)' : 'var(--color-kunyit-300)' }}
      >
        TokoPilot
      </span>
    </span>
  )
}
