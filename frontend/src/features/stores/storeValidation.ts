import type { StoreTimezone } from '@/services/auth'

export interface StoreFormValues {
  name: string
  address: string
  timezone: StoreTimezone
}

export type StoreFormErrors = Partial<Record<keyof StoreFormValues, string>>

/** Mirrors backend rules for instant feedback; the API remains authoritative. */
export function validateStore(v: StoreFormValues): StoreFormErrors {
  const e: StoreFormErrors = {}
  if (!v.name.trim()) e.name = 'Nama toko wajib diisi.'
  else if (v.name.trim().length > 100) e.name = 'Nama toko maksimal 100 karakter.'
  if (v.address.trim().length > 500) e.address = 'Alamat maksimal 500 karakter.'
  return e
}
