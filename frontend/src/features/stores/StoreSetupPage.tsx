import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, LogOut } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { ME_KEY, useMe, useResetSession } from '@/app/session'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Loader'
import { ApiError, fieldErrors } from '@/lib/api'
import { authApi, type Me, storeApi } from '@/services/auth'
import { AuthHeading, AuthLayout } from '@/features/auth/AuthLayout'
import { FormShell, ReceiptPreview, StoreFields } from './StoreForm'
import { type StoreFormErrors, type StoreFormValues, validateStore } from './storeValidation'

export function StoreSetupPage({ now = () => new Date() }: { now?: () => Date }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const reset = useResetSession()
  const [values, setValues] = useState<StoreFormValues>({ name: '', address: '', timezone: 'Asia/Jakarta' })
  const [errors, setErrors] = useState<StoreFormErrors>({})

  const create = useMutation({
    mutationFn: () =>
      storeApi.create({ name: values.name, timezone: values.timezone, ...(values.address.trim() ? { address: values.address } : {}) }),
    onSuccess: (membership) => {
      qc.setQueryData<Me | null>(ME_KEY, (old) => (old ? { ...old, membership } : old))
      navigate('/dashboard', { replace: true })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'STORE_ALREADY_EXISTS') {
        void qc.invalidateQueries({ queryKey: ME_KEY })
        return
      }
      setErrors(fieldErrors(err))
    },
  })

  const logout = useMutation({ mutationFn: authApi.logout, onSettled: () => { reset(); navigate('/login') } })

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = validateStore(values)
    setErrors(v)
    if (Object.keys(v).length === 0) create.mutate()
  }

  const err = create.error
  const generic = err && Object.keys(fieldErrors(err)).length === 0

  return (
    <AuthLayout step={2} photo={false} aside={<ReceiptPreview values={values} now={now()} />}>
      <AuthHeading eyebrow="Langkah 2 dari 3" title="Siapkan tokomu">
        {me ? <>Halo, {me.user.name.split(' ')[0]}. </> : null}
        Data ini muncul di kop nota dan menentukan batas hari laporan. Bisa diubah nanti.
      </AuthHeading>

      <FormShell onSubmit={submit}>
        {generic && (
          <Alert tone="danger">{err instanceof ApiError ? err.message : 'Terjadi kesalahan. Coba lagi.'}</Alert>
        )}
        <StoreFields
          values={values}
          errors={errors}
          onChange={(patch) => {
            setValues((v) => ({ ...v, ...patch }))
            setErrors((x) => ({ ...x, ...Object.fromEntries(Object.keys(patch).map((k) => [k, undefined])) }))
          }}
        />
        <div className="lg:hidden">
          <ReceiptPreview values={values} now={now()} />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={create.isPending}>
          {create.isPending ? <Spinner /> : null}
          {create.isPending ? 'Menyiapkan toko…' : 'Buat toko & masuk dasbor'}
          {!create.isPending && <ArrowRight className="size-4" aria-hidden />}
        </Button>
      </FormShell>

      <button
        type="button"
        onClick={() => logout.mutate()}
        className="mt-8 inline-flex items-center gap-2 text-sm text-text-muted hover:text-ink-900"
      >
        <LogOut className="size-4" aria-hidden /> Bukan akunmu? Keluar
      </button>
    </AuthLayout>
  )
}
