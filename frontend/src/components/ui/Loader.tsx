import { LogoMark } from '@/components/brand/Logo'
import { cn } from '@/lib/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
    />
  )
}

/** Shown while the session is being resolved. */
export function FullPageLoader({ label = 'Membuka buku toko…' }: { label?: string }) {
  return (
    <div role="status" className="ledger-lines grid min-h-dvh place-items-center bg-paper-50">
      <div className="flex flex-col items-center gap-4">
        <LogoMark className="size-10 animate-pulse" />
        <p className="eyebrow text-text-subtle">{label}</p>
      </div>
    </div>
  )
}
