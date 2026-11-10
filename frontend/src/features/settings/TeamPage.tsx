import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, UserPlus, Users } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Stamp } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { TextField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Loader'
import { ApiError, fieldErrors } from '@/lib/api'
import { formatStoreDate } from '@/lib/format'
import { storeApi } from '@/services/auth'
import { PageHeader } from './PageHeader'

type Fields = 'name' | 'email' | 'password'
const empty: Record<Fields, string> = { name: '', email: '', password: '' }

function validate(v: Record<Fields, string>) {
  const e: Partial<Record<Fields, string>> = {}
  if (!v.name.trim()) e.name = 'Nama wajib diisi.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = 'Format email tidak valid.'
  if (v.password.length < 8) e.password = 'Password minimal 8 karakter.'
  return e
}

function AddStaffForm() {
  const qc = useQueryClient()
  const [values, setValues] = useState(empty)
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({})
  const [added, setAdded] = useState<string | null>(null)

  const add = useMutation({
    mutationFn: () => storeApi.addStaff(values),
    onSuccess: (m) => {
      setAdded(m.name)
      setValues(empty)
      void qc.invalidateQueries({ queryKey: ['settings', 'team'] })
    },
    onError: (err) => setErrors(fieldErrors(err)),
  })

  const set = (k: Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setAdded(null)
    setValues((v) => ({ ...v, [k]: e.target.value }))
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = validate(values)
    setErrors(v)
    if (Object.keys(v).length === 0) add.mutate()
  }

  const generic = add.error && Object.keys(fieldErrors(add.error)).length === 0

  return (
    <section className="rounded-md bg-white p-6 ring-1 ring-paper-300">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <UserPlus className="size-5 text-daun-700" aria-hidden /> Tambah staf
      </h2>
      <form onSubmit={submit} noValidate className="mt-5 space-y-4">
        {added && <Alert tone="positive">{added} ditambahkan sebagai staf.</Alert>}
        {generic && <Alert tone="danger">{add.error instanceof ApiError ? add.error.message : 'Gagal menambah staf.'}</Alert>}
        <TextField label="Nama" value={values.name} onChange={set('name')} error={errors.name} autoComplete="off" />
        <TextField label="Email" type="email" value={values.email} onChange={set('email')} error={errors.email} autoComplete="off" />
        <TextField
          label="Password awal"
          type="password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete="new-password"
          helper="Bagikan langsung kepada staf, jangan lewat grup chat."
        />
        <Button type="submit" className="w-full" disabled={add.isPending}>
          {add.isPending ? <Spinner /> : <UserPlus className="size-4" aria-hidden />}
          {add.isPending ? 'Menambahkan…' : 'Tambah staf'}
        </Button>
      </form>
      <div className="mt-5 flex gap-2.5 rounded-sm bg-paper-100 p-3 text-[0.8125rem] text-text-muted">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>Staf dapat mencatat transaksi dan melihat data toko, tetapi tidak dapat mengubah produk, stok, atau pengaturan.</p>
      </div>
    </section>
  )
}

export function TeamPage() {
  const team = useQuery({ queryKey: ['settings', 'team'], queryFn: () => storeApi.team() })

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administrasi" title="Anggota toko">
        Satu owner, beberapa staf. Hak akses diperiksa di server pada setiap permintaan.
      </PageHeader>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Daftar anggota" className="self-start overflow-hidden rounded-md bg-white ring-1 ring-paper-300">
          {team.isPending && (
            <div role="status" className="space-y-px">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse bg-paper-100" />
              ))}
              <span className="sr-only">Memuat anggota…</span>
            </div>
          )}
          {team.isError && (
            <div className="p-6">
              <Alert tone="danger" title="Anggota tidak dapat dimuat">
                {team.error instanceof ApiError ? team.error.message : 'Coba muat ulang halaman.'}
              </Alert>
            </div>
          )}
          {team.data && team.data.data.length === 0 && (
            <EmptyState icon={<Users className="size-5" aria-hidden />} title="Belum ada anggota" className="m-6" />
          )}
          {team.data && team.data.data.length > 0 && (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Anggota toko dan perannya</caption>
              <thead className="border-b border-paper-300 bg-paper-50">
                <tr className="eyebrow text-text-subtle">
                  <th scope="col" className="px-5 py-3 font-semibold">Nama</th>
                  <th scope="col" className="hidden px-5 py-3 font-semibold sm:table-cell">Bergabung</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Peran</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-200">
                {team.data.data.map((m) => (
                  <tr key={m.user_id}>
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-ink-900">{m.name}</div>
                      <div className="num text-[0.75rem] text-text-muted">{m.email}</div>
                    </td>
                    <td className="hidden px-5 py-3.5 text-text-muted sm:table-cell">
                      {formatStoreDate(new Date(m.joined_at)).replace(/^\w+, /, '')}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Stamp tone={m.role === 'OWNER' ? 'positive' : 'ink'} tilt={m.role === 'OWNER' ? -3 : 2} className="text-[0.625rem]">
                        {m.role === 'OWNER' ? 'Owner' : 'Staf'}
                      </Stamp>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {team.data && (
            <p className="num border-t border-paper-200 px-5 py-3 text-[0.75rem] text-text-subtle">
              {team.data.meta.total} anggota
            </p>
          )}
        </section>
        <AddStaffForm />
      </div>
    </div>
  )
}
