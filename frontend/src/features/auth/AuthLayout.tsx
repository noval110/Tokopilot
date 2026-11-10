import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import pedagang from '@/assets/photos/pedagang-pasar-lampung.webp'
import { Logo } from '@/components/brand/Logo'
import { cn } from '@/lib/cn'

const steps = ['Buat akun', 'Siapkan toko', 'Mulai mencatat']

/**
 * Split layout for login, register and onboarding: a turmeric shop board under
 * a striped awning, with a real market photo taped on. Doubles as onboarding progress.
 */
export function AuthLayout({
  step,
  aside,
  photo = true,
  children,
}: {
  /** 1-based onboarding step to highlight; omit on the login page. */
  step?: 1 | 2
  aside?: ReactNode
  /** Show the market photo (off when the aside is itself a large preview). */
  photo?: boolean
  children: ReactNode
}) {
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] bg-paper-50 [background-image:var(--grain)] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="relative hidden flex-col overflow-hidden border-r-2 border-ink-900 bg-kunyit-300 lg:flex">
        <div aria-hidden className="awning animate-drop h-14 shrink-0" />
        <div className="flex flex-1 flex-col gap-10 p-10 pt-6 xl:p-14 xl:pt-8">
          <Link to="/" className="w-fit">
            <Logo />
          </Link>

          <div className="flex flex-1 flex-col justify-center gap-10">
            {photo && (
              <div className="animate-pop relative w-full max-w-md" style={{ ['--tilt' as string]: '-2.5deg' }}>
                <span aria-hidden className="tape -top-3 left-10 z-10 -rotate-6" />
                <span aria-hidden className="tape -top-3 right-10 z-10 rotate-6" />
                <img
                  src={pedagang}
                  alt="Pedagang di Pasar Gudang Lelang, Lampung, melayani pembeli"
                  className="aspect-[5/4] w-full border-[8px] border-white object-cover object-top shadow-sign outline-2 outline-ink-900"
                />
              </div>
            )}
            <div className="animate-rise" style={{ ['--d' as string]: '0.25s' }}>{aside}</div>
          </div>

          {step ? (
            <ol className="flex flex-wrap gap-2.5" aria-label="Langkah pendaftaran">
              {steps.map((label, i) => {
                const n = i + 1
                const done = n < step
                const current = n === step
                return (
                  <li
                    key={label}
                    className={cn(
                      'flex items-center gap-2.5 rounded-sm border-2 py-1.5 pr-3.5 pl-1.5 text-[0.9375rem] font-semibold',
                      current ? 'border-ink-900 bg-white text-ink-900 shadow-(--shadow-glow)' : done ? 'border-ink-900 bg-daun-100 text-ink-900' : 'border-ink-900/40 text-ink-800',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-7 place-items-center rounded-xs border-2 border-ink-900 text-[0.8125rem] font-black',
                        done ? 'bg-daun-700 text-white' : current ? 'bg-cabe-600 text-white' : 'bg-paper-50 text-ink-900',
                      )}
                    >
                      {done ? <Check className="size-3.5 stroke-[3]" aria-hidden /> : n}
                    </span>
                    {label}
                    {current && <span className="sr-only">(langkah saat ini)</span>}
                    {done && <span className="sr-only">(selesai)</span>}
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="scribble text-lg text-ink-900">data tokomu, hanya milikmu</p>
          )}
        </div>
      </div>

      <main className="flex flex-col px-6 py-10 sm:px-12 lg:px-16 xl:px-24">
        <Link to="/" className="mb-12 w-fit lg:hidden">
          <Logo />
        </Link>
        <div className="animate-rise mx-auto w-full max-w-md lg:my-auto">{children}</div>
      </main>
    </div>
  )
}

export function AuthHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <p className="eyebrow inline-flex rounded-xs border-2 border-ink-900 bg-kunyit-300 px-2 py-0.5 text-ink-900">{eyebrow}</p>
      <h1 className="mt-5 text-[2.6rem] leading-[1.08]">{title}</h1>
      {children && <p className="mt-3 text-lg text-text-muted">{children}</p>}
    </div>
  )
}
