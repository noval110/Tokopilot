import { isRouteErrorResponse, useRouteError } from 'react-router'
import { LogoMark } from '@/components/brand/Logo'
import { ButtonLink } from '@/components/ui/Button'
import { Stamp } from '@/components/ui/Badge'

function Frame({ code, title, body }: { code: string; title: string; body: string }) {
  return (
    <main className="ledger-lines grid min-h-dvh place-items-center bg-paper-50 px-6">
      <div className="max-w-md text-center">
        <LogoMark className="mx-auto size-10" />
        <div className="mt-8">
          <Stamp tone="ink" tilt={-6} className="text-sm">
            {code}
          </Stamp>
        </div>
        <h1 className="mt-6 text-4xl font-bold">{title}</h1>
        <p className="mt-3 text-text-muted">{body}</p>
        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink to="/dashboard">Ke dasbor</ButtonLink>
          <ButtonLink to="/" variant="secondary">
            Beranda
          </ButtonLink>
        </div>
      </div>
    </main>
  )
}

export function NotFoundPage() {
  return (
    <Frame
      code="404 · Halaman kosong"
      title="Halaman ini tidak ada di buku."
      body="Alamat yang kamu buka tidak ditemukan. Mungkin salah ketik, atau halamannya sudah dipindah."
    />
  )
}

/** Router-level error boundary. Never prints stack traces to the user. */
export function RouteErrorPage() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />
  if (import.meta.env.DEV) console.error(error)
  return (
    <Frame
      code="Gangguan"
      title="Ada yang tidak beres."
      body="Halaman gagal dimuat. Data tokomu aman. Coba muat ulang, atau kembali ke dasbor."
    />
  )
}
