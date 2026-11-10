import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { ME_KEY } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Loader'
import { ApiError, fieldErrors } from '@/lib/api'
import { type Me, type Store, storeApi } from '@/services/auth'
import { FormShell, ReceiptPreview, StoreFields } from '@/features/stores/StoreForm'
import { type StoreFormErrors, type StoreFormValues, validateStore } from '@/features/stores/storeValidation'
import { PageHeader } from './PageHeader'

const toValues = (s: Store): StoreFormValues => ({ name: s.name, address: s.address ?? '', timezone: s.timezone })

function SettingsForm({ store, now }: { store: Store; now: Date }) {
  const qc = useQueryClient()
  const [values, setValues] = useState<StoreFormValues>(() => toValues(store))
  const [errors, setErrors] = useState<StoreFormErrors>({})
  const [saved, setSaved] = useState(false)

  const initial = toValues(store)
  const dirty = values.name !== initial.name || values.address !== initial.address || values.timezone !== initial.timezone

  const save = useMutation({
    mutationFn: () => storeApi.updateSettings({ name: values.name, address: values.address, timezone: values.timezone }),
    onSuccess: (updated) => {
      qc.setQueryData(['settings', 'store'], updated)
      qc.setQueryData<Me | null>(ME_KEY, (old) =>
        old?.membership ? { ...old, membership: { ...old.membership, store: updated } } : old,
      )
      setValues(toValues(updated))
      setSaved(true)
    },
    onError: (err) => setErrors(fieldErrors(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setSaved(false)
    const v = validateStore(values)
    setErrors(v)
    if (Object.keys(v).length === 0) save.mutate()
  }

  const generic = save.error && Object.keys(fieldErrors(save.error)).length === 0

  return (
    <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="rounded-md bg-white p-6 ring-1 ring-paper-300 sm:p-8">
        <FormShell onSubmit={submit}>
          {saved && !dirty && <Alert tone="positive">Pengaturan toko tersimpan.</Alert>}
          {generic && (
            <Alert tone="danger">{save.error instanceof ApiError ? save.error.message : 'Gagal menyimpan. Coba lagi.'}</Alert>
          )}
          <StoreFields
            values={values}
            errors={errors}
            onChange={(patch) => {
              setSaved(false)
              setValues((v) => ({ ...v, ...patch }))
            }}
          />
          {values.timezone !== initial.timezone && (
            <Alert tone="warning" title="Zona waktu akan berubah">
              Batas hari pada laporan akan mengikuti zona baru. Data transaksi tidak berubah.
            </Alert>
          )}
          <div className="flex items-center justify-end gap-3 border-t border-paper-300 pt-5">
            <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => { setValues(initial); setErrors({}) }}>
              Batalkan perubahan
            </Button>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? <Spinner /> : <Save className="size-4" aria-hidden />}
              {save.isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </div>
        </FormShell>
      </section>
      <aside className="hidden lg:block">
        <ReceiptPreview values={values} now={now} />
      </aside>
    </div>
  )
}

export function StoreSettingsPage({ now = () => new Date() }: { now?: () => Date }) {
  const query = useQuery({ queryKey: ['settings', 'store'], queryFn: storeApi.settings })

  return (
    <div className="animate-rise">
      <PageHeader eyebrow="Administrasi" title="Pengaturan toko">
        Profil dasar toko. Mata uang tetap IDR pada MVP.
      </PageHeader>
      {query.isPending && (
        <div role="status" className="mt-8 h-96 animate-pulse rounded-md bg-paper-100 ring-1 ring-paper-300">
          <span className="sr-only">Memuat pengaturan…</span>
        </div>
      )}
      {query.isError && (
        <Alert tone="danger" title="Pengaturan tidak dapat dimuat" className="mt-8">
          {query.error instanceof ApiError ? query.error.message : 'Coba muat ulang halaman.'}
        </Alert>
      )}
      {query.data && <SettingsForm key={query.data.id} store={query.data} now={now()} />}
    </div>
  )
}
