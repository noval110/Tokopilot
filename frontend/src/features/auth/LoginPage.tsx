import { useMutation } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useSetMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Loader'
import { ApiError } from '@/lib/api'
import { safeNext } from '@/lib/navigation'
import { authApi } from '@/services/auth'
import { AuthHeading, AuthLayout } from './AuthLayout'

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const setMe = useSetMe()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: (me) => {
      setMe(me)
      navigate(me.membership ? (safeNext(params.get('next')) ?? '/dashboard') : '/onboarding/store', { replace: true })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!email.trim()) next.email = 'Email wajib diisi.'
    if (!password) next.password = 'Password wajib diisi.'
    setErrors(next)
    if (Object.keys(next).length === 0) login.mutate({ email, password })
  }

  const err = login.error
  const message =
    err instanceof ApiError
      ? err.code === 'RATE_LIMITED'
        ? 'Terlalu banyak percobaan masuk. Tunggu beberapa menit lalu coba lagi.'
        : err.message
      : err
        ? 'Terjadi kesalahan. Coba lagi.'
        : null

  return (
    <AuthLayout
      aside={
        <blockquote className="max-w-sm">
          <p className="font-sign painted text-[2.2rem] leading-[1.1] text-ink-900" style={{ ["--paint" as string]: "var(--color-white)" }}>
            “Akurat dulu,
            <br />
            pintar kemudian.”
          </p>
          <footer className="mt-4 text-[0.9375rem] font-medium text-ink-700">Prinsip produk TokoPilot</footer>
        </blockquote>
      }
    >
      <AuthHeading eyebrow="Selamat datang kembali" title="Masuk ke tokomu" />

      <form onSubmit={submit} noValidate className="space-y-5">
        {message && <Alert tone="danger">{message}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoFocus
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
          {login.isPending ? <Spinner /> : null}
          {login.isPending ? 'Memeriksa…' : 'Masuk'}
          {!login.isPending && <ArrowRight className="size-4" aria-hidden />}
        </Button>
      </form>

      <p className="mt-8 border-t border-paper-300 pt-6 text-sm text-text-muted">
        Belum punya akun?{' '}
        <Link to="/register" className="font-semibold text-daun-800 underline-offset-4 hover:underline">
          Buat akun toko
        </Link>
      </p>
    </AuthLayout>
  )
}
