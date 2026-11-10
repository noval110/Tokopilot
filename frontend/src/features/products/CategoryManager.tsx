import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Check, Pencil, Plus, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Loader'
import { ApiError, fieldErrors } from '@/lib/api'
import { catalogApi, catalogKeys, type Category } from '@/services/catalog'

function errText(err: unknown): string | undefined {
  if (!err) return undefined
  return fieldErrors(err)['name'] ?? (err instanceof ApiError ? err.message : 'Terjadi kesalahan.')
}

function CategoryRow({ c }: { c: Category }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [name, setName] = useState(c.name)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: catalogKeys.categories })
    void qc.invalidateQueries({ queryKey: ['products'] })
  }
  const rename = useMutation({ mutationFn: () => catalogApi.renameCategory(c.id, name), onSuccess: () => { setEditing(false); refresh() } })
  const archive = useMutation({ mutationFn: () => catalogApi.archiveCategory(c.id), onSuccess: refresh })

  if (editing) {
    return (
      <li className="py-3">
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename.mutate() }}
          className="flex items-start gap-2"
        >
          <TextField label={`Ubah nama ${c.name}`} value={name} onChange={(e) => setName(e.target.value)} error={errText(rename.error)} maxLength={60} autoFocus className="flex-1 [&_label]:sr-only" />
          <Button type="submit" size="sm" className="mt-1.5" disabled={rename.isPending || !name.trim()} aria-label="Simpan nama">
            {rename.isPending ? <Spinner /> : <Check className="size-4" />}
          </Button>
          <Button variant="ghost" size="sm" className="mt-1.5" onClick={() => { setEditing(false); setName(c.name); rename.reset() }} aria-label="Batal">
            <X className="size-4" />
          </Button>
        </form>
      </li>
    )
  }

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-ink-900">{c.name}</div>
          <div className="num text-[0.75rem] text-text-subtle">{c.product_count ?? 0} produk aktif</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Ubah nama ${c.name}`}>
          <Pencil className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(true)} aria-label={`Arsipkan ${c.name}`}>
          <Archive className="size-4" />
        </Button>
      </div>
      {confirmArchive && (
        <div className="mt-3 rounded-sm bg-warn-50 p-3 text-[0.8125rem] text-warn-800 ring-1 ring-warn-200">
          <p>
            Arsipkan <strong>{c.name}</strong>? Kategori hilang dari pilihan, tetapi produk yang sudah memakainya tetap menyimpannya.
          </p>
          {archive.error && <p className="mt-2 font-semibold">{errText(archive.error)}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmArchive(false)}>Batal</Button>
            <Button variant="danger" size="sm" disabled={archive.isPending} onClick={() => archive.mutate()}>
              {archive.isPending ? <Spinner /> : null} Arsipkan
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

export function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const categories = useQuery({ queryKey: catalogKeys.categories, queryFn: () => catalogApi.categories(), enabled: open })
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => catalogApi.createCategory(name),
    onSuccess: () => {
      setName('')
      void qc.invalidateQueries({ queryKey: catalogKeys.categories })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }

  return (
    <Dialog open={open} onClose={onClose} title="Kategori produk" description="Kelompokkan produk agar mudah dicari dan dilaporkan." size="lg">
      <form onSubmit={submit} className="flex items-start gap-2">
        <TextField label="Nama kategori baru" value={name} onChange={(e) => setName(e.target.value)} error={errText(create.error)} maxLength={60} className="flex-1 [&_label]:sr-only" placeholder="Nama kategori baru" data-autofocus />
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? <Spinner /> : <Plus className="size-4" aria-hidden />} Tambah
        </Button>
      </form>

      <div className="mt-4">
        {categories.isPending && <p role="status" className="py-6 text-center text-sm text-text-muted">Memuat kategori…</p>}
        {categories.isError && <Alert tone="danger">Kategori tidak dapat dimuat.</Alert>}
        {categories.data && categories.data.data.length === 0 && (
          <p className="py-6 text-center text-sm text-text-muted">Belum ada kategori.</p>
        )}
        {categories.data && categories.data.data.length > 0 && (
          <ul className="divide-y divide-paper-200">
            {categories.data.data.map((c) => (
              <CategoryRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
