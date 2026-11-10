import { useEffect, useState } from 'react'
import { motionAllowed } from '@/lib/motion'

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

/**
 * Mechanical-counter figure: every digit rolls into place like the wheels on a
 * market scale. Screen readers and text search get the final value at once
 * (sr-only); without motion it is plain text.
 */
export function RollingNumber({ value, format, delayMs = 0 }: { value: number; format: (n: number) => string; delayMs?: number }) {
  const text = format(value)
  const animated = motionAllowed()
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!animated) return
    // Two frames: let the wheels mount at 0, then roll to the target.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setArmed(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [animated])

  if (!animated) return <>{text}</>

  const chars = [...text]
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="num inline-flex leading-none">
        {chars.map((ch, i) => {
          const d = DIGITS.indexOf(ch)
          if (d < 0) return <span key={`${i}-${ch}`} className="whitespace-pre">{ch}</span>
          const fromRight = chars.length - i
          return (
            // The invisible target digit sizes the cell, so proportional figures keep their natural spacing.
            <span key={`d${fromRight}`} className="relative inline-block h-[1em] overflow-hidden">
              <span className="invisible">{ch}</span>
              <span
                className="absolute inset-x-0 top-0 flex flex-col items-center transition-transform duration-[1300ms] ease-(--ease-spring)"
                style={{ transform: `translateY(${armed ? -d : 0}em)`, transitionDelay: `${delayMs + i * 55}ms` }}
              >
                {DIGITS.map((n) => (
                  <span key={n} className="block h-[1em] leading-none">{n}</span>
                ))}
              </span>
            </span>
          )
        })}
      </span>
    </>
  )
}
