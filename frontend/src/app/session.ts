import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'
import { authApi, type Me } from '@/services/auth'

export const ME_KEY = ['me'] as const

/**
 * Current session. Resolves to null when not logged in (401) so guards can
 * redirect; other errors surface as query errors.
 */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await authApi.me()
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 60_000,
    retry: false,
  })
}

export function useSetMe() {
  const qc = useQueryClient()
  return (me: Me | null) => qc.setQueryData(ME_KEY, me)
}

/** Clears every cached query (other users' data must never linger after logout). */
export function useResetSession() {
  const qc = useQueryClient()
  return () => {
    qc.clear()
    qc.setQueryData(ME_KEY, null)
  }
}

/**
 * The session already in the cache, without fetching. Public pages use it to say
 * "Ke dasbor" to someone who just came from the app, while staying API-free.
 */
export function useCachedMe(): Me | null {
  const qc = useQueryClient()
  return qc.getQueryData<Me | null>(ME_KEY) ?? null
}
