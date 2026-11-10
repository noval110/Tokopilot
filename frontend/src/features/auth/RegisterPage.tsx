import { useMutation } from '@tanstack/react-query'
import { ArrowRight, ScrollText, ShieldCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useSetMe } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Loader'
import { ApiError, fieldErrors } from '@/lib/api'
import { authApi } from '@/services/auth'
import { AuthHeading, AuthLayout } from './AuthLayout'

type Fields = 'name' | 'email' | 'password'

/** Mirrors backend rules for instant feedback; the API remains authoritative. */
function validate(v: Record<Fields, string>): Partial<Record<Fields, string>> {
  const e: Partial<Record<Fields, string>> = {}
  if (!v.name.trim()) e.name = 'Nama wajib diisi.'
  else if (v.name.trim().length > 100) e.name = 'Nama maksimal 100 karakter.'
  if (!v.email.trim()) e.email = 'Email wajib diisi.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = 'Format email tidak valid.'
  if (v.password.length < 8) e.password = 'Password minimal 8 karakter.'
  else if (v.password.length > 128) e.password = 'Password maksimal 128 karakter.'
  return e
}

export function RegisterPage() {
  const navigate = useNavigate()
  const setMe = useSetMe()
  const [values, setValues] = useState<Record<Fields, string>>({ name: '', email: '', password: '' })
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({})

  const register = useMutation({
    mutationFn: authApi.register,
    onSuccess: (me) => {
      setMe(me)
      navigate('/onboarding/store', { replace: true })
    },
    onError: (err) => setErrors(fieldErrors(err)),
  })

  const set = (k: Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }))
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = validate(values)
    setErrors(v)
    if (Object.keys(v).length === 0) register.mutate(values)
  }

  const err = register.error
  const showGeneric = err && Object.keys(fieldErrors(err)).length === 0

  return (
    <AuthLayout
      step={1}
      aside={
        <ul className="max-w-md space-y-3">
          <li className="flex gap-3 rounded-sm border-2 border-ink-900 bg-white p-4 shadow-lift">
            <ScrollText className="mt-0.5 size-5 shrink-0 text-daun-700" aria-hidden />
            <p className="text-ink-700">
              <span className="font-semibold text-ink-900">Buku besar yang tidak bisa dihapus diam-diam.</span>{' '}
              Setiap mutasi stok tercatat permanen.
            </p>
          </li>
          <li className="flex gap-3 rounded-sm border-2 border-ink-900 bg-white p-4 shadow-lift">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-daun-700" aria-hidden />
            <p className="text-ink-700">
              <span className="font-semibold text-ink-900">Password di-hash dengan argon2id.</span> Kami tidak pernah
              menyimpan atau melihat password aslimu.
            </p>
          </li>
        </ul>
      }
    >
      <AuthHeading eyebrow="Langkah 1 dari 3" title="Buat akun toko">
        Satu akun untuk satu toko. Kamu otomatis menjadi owner setelah toko dibuat.
      </AuthHeading>

      <form onSubmit={submit} noValidate className="space-y-5">
        {showGeneric && (
          <Alert tone="danger">
            {err instanceof ApiError && err.code === 'RATE_LIMITED'
              ? 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.'
              : err instanceof ApiError
                ? err.message
                : 'Terjadi kesalahan. Coba lagi.'}
          </Alert>
        )}
        <TextField label="Nama lengkap" autoComplete="name" value={values.name} onChange={set('name')} error={errors.name} autoFocus />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={set('email')}
          error={errors.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
          helper="Minimal 8 karakter. Frasa panjang lebih aman daripada simbol acak."
        />
        <Button type="submit" size="lg" className="w-full" disabled={register.isPending}>
          {register.isPending ? <Spinner /> : null}
          {register.isPending ? 'Membuat akun…' : 'Buat akun'}
          {!register.isPending && <ArrowRight className="size-4" aria-hidden />}
        </Button>
      </form>

      <p className="mt-8 border-t border-paper-300 pt-6 text-sm text-text-muted">
        Sudah punya akun?{' '}
        <Link to="/login" className="font-semibold text-daun-800 underline-offset-4 hover:underline">
          Masuk
        </Link>
      </p>
    </AuthLayout>
  )
}
