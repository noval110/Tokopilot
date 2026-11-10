import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useMe } from '@/app/session'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageLoader } from '@/components/ui/Loader'
import { Alert } from '@/components/ui/Alert'

/*
 * Client-side guards only shape navigation. Every rule here is enforced again
 * by the Go API (session, store membership, role) — hiding a screen is never
 * the security boundary.
 */

function SessionError() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper-50 px-6">
      <Alert tone="danger" title="Tidak dapat memuat sesi" className="max-w-md">
        Server tidak dapat dihubungi. Periksa koneksi, lalu muat ulang halaman.
      </Alert>
    </div>
  )
}

/** Requires a logged-in user; otherwise redirects to /login?next=… */
export function RequireAuth() {
  const { data: me, isPending, isError } = useMe()
  const location = useLocation()
  if (isPending) return <FullPageLoader />
  if (isError) return <SessionError />
  if (!me) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <Outlet />
}

/** Requires a store membership; new users go to onboarding first. */
export function RequireStore() {
  const { data: me } = useMe()
  if (!me?.membership) return <Navigate to="/onboarding/store" replace />
  return <Outlet />
}

/** Onboarding is only for users who do not have a store yet. */
export function RequireNoStore() {
  const { data: me } = useMe()
  if (me?.membership) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/** Login/register pages bounce authenticated users to where they belong. */
export function GuestOnly() {
  const { data: me, isPending } = useMe()
  if (isPending) return <FullPageLoader />
  if (me) return <Navigate to={me.membership ? '/dashboard' : '/onboarding/store'} replace />
  return <Outlet />
}

/** Owner-only screen. Staff see an explanation instead of the content. */
export function OwnerOnly({ children }: { children: ReactNode }) {
  const { data: me } = useMe()
  if (me?.membership?.role === 'OWNER') return <>{children}</>
  return (
    <EmptyState
      icon={<Lock className="size-5" aria-hidden />}
      title="Halaman khusus owner"
      action={<ButtonLink to="/dashboard" variant="secondary">Kembali ke dasbor</ButtonLink>}
    >
      Akun staf dapat mencatat transaksi dan melihat data toko, tetapi tidak dapat mengubah pengaturan.
    </EmptyState>
  )
}