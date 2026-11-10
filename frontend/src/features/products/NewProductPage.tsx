import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { normalizeQuantityInput } from '@/lib/quantity'
import { catalogApi, catalogKeys } from '@/services/catalog'
import { PageHeader } from '@/features/settings/PageHeader'
import { ProductForm } from './ProductForm'
import { emptyProduct, type ProductFormValues, toPayload } from './productModel'

export function NewProductPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const categories = useQuery({ queryKey: catalogKeys.categories, queryFn: () => catalogApi.categories() })

  const create = useMutation({
    mutationFn: (v: ProductFormValues) =>
      catalogApi.createProduct({ ...toPayload(v), initial_stock: normalizeQuantityInput(v.initial_stock) || '0' }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['products'] })
      void qc.invalidateQueries({ queryKey: catalogKeys.categories })
      qc.setQueryData(catalogKeys.product(p.id), p)
      navigate(`/products/${p.id}`, { replace: true, state: { created: true } })
    },
  })

  return (
    <div className="animate-rise">
      <Link to="/products" className="mb-5 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-ink-900">
        <ArrowLeft className="size-4" aria-hidden /> Semua produk
      </Link>
      <PageHeader eyebrow="Katalog" title="Tambah produk">
        Stok awal dicatat di buku besar sebagai mutasi pertama produk ini.
      </PageHeader>
      <div className="mt-8">
        <ProductForm
          initial={emptyProduct}
          creating
          submitLabel="Simpan produk"
          pending={create.isPending}
          error={create.error}
          onSubmit={(v) => create.mutate(v)}
          categoryName={(id) => categories.data?.data.find((c) => c.id === id)?.name}
        />
      </div>
    </div>
  )
}
