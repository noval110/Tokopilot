import { useSearchParams } from 'react-router'
import { useMe } from '@/app/session'
import { storeToday } from '@/lib/format'
import { type Preset, presetRange } from '@/lib/period'

/** Period from the URL (?range=today|7d|30d|custom&from&to); default 7 days in store time. */
export function usePeriod(now: () => Date = () => new Date()) {
  const { data: me } = useMe()
  const tz = me?.membership?.store.timezone ?? 'Asia/Jakarta'
  const [params, setParams] = useSearchParams()
  const today = storeToday(now(), tz)
  const raw = params.get('range')
  const preset: Preset = raw === 'today' || raw === '30d' || raw === 'custom' ? raw : '7d'
  const range =
    preset === 'custom'
      ? { from: params.get('from') ?? presetRange('7d', today).from, to: params.get('to') ?? today }
      : presetRange(preset, today)
  const set = (next: Preset, custom?: { from?: string; to?: string }) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === '7d') p.delete('range')
        else p.set('range', next)
        if (next === 'custom') {
          p.set('from', custom?.from ?? range.from)
          p.set('to', custom?.to ?? range.to)
        } else {
          p.delete('from')
          p.delete('to')
        }
        return p
      },
      { replace: true },
    )
  }
  return { preset, range, today, timezone: tz, set }
}

export type PeriodState = ReturnType<typeof usePeriod>
