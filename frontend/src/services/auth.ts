import { apiFetch } from '@/lib/api'

export type Role = 'OWNER' | 'STAFF'
export type StoreTimezone = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura'

export interface User {
  id: string
  name: string
  email: string
}

export interface Store {
  id: string
  name: string
  timezone: StoreTimezone
  currency: 'IDR'
  address: string | null
}

export interface Membership {
  role: Role
  store: Store
}

export interface Me {
  user: User
  membership: Membership | null
}

export interface Member {
  user_id: string
  name: string
  email: string
  role: Role
  joined_at: string
}

export interface Page<T> {
  data: T[]
  meta: { page: number; per_page: number; total: number }
}

export const authApi = {
  me: () => apiFetch<Me>('/me'),
  register: (body: { name: string; email: string; password: string }) =>
    apiFetch<Me>('/auth/register', { method: 'POST', body }),
  login: (body: { email: string; password: string }) => apiFetch<Me>('/auth/login', { method: 'POST', body }),
  logout: () => apiFetch<undefined>('/auth/logout', { method: 'POST' }),
}

export const storeApi = {
  create: (body: { name: string; address?: string; timezone: StoreTimezone }) =>
    apiFetch<Membership>('/stores', { method: 'POST', body }),
  settings: () => apiFetch<Store>('/settings/store'),
  updateSettings: (body: Partial<{ name: string; address: string; timezone: StoreTimezone }>) =>
    apiFetch<Store>('/settings/store', { method: 'PATCH', body }),
  team: (page = 1) => apiFetch<Page<Member>>(`/settings/team?page=${page}&per_page=50`),
  addStaff: (body: { name: string; email: string; password: string }) =>
    apiFetch<Member>('/settings/team', { method: 'POST', body }),
}

export const TIMEZONES: Array<{ value: StoreTimezone; label: string; city: string }> = [
  { value: 'Asia/Jakarta', label: 'WIB', city: 'Jakarta · Sumatra · Jawa · Kalbar' },
  { value: 'Asia/Makassar', label: 'WITA', city: 'Makassar · Bali · NTB · NTT · Kaltim' },
  { value: 'Asia/Jayapura', label: 'WIT', city: 'Jayapura · Maluku · Papua' },
]
