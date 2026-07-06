import { useEffect, useRef, useState } from 'react'

/**
 * Animates a numeric value toward its target with an ease-out cubic
 * count-up (rAF-driven, ~600ms). The first non-null value animates from
 * zero (the reveal moment); subsequent changes animate from the value
 * currently displayed, so realtime/refresh updates tick rather than jump.
 *
 * Respects prefers-reduced-motion (jumps straight to the target) and
 * returns null while the input is null so loading skeletons stay in
 * control of the empty state.
 */
export function useCountUp(target: number | null, durationMs = 600): number | null {
  const [display, setDisplay] = useState<number | null>(target)
  const displayRef = useRef<number | null>(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    if (target === null) {
      displayRef.current = null
      setDisplay(null)
      return
    }

    const from = displayRef.current ?? 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || from === target) {
      displayRef.current = target
      setDisplay(target)
      return
    }

    const start = performance.now()
    const delta = target - from
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      const value = t >= 1 ? target : from + delta * eased
      displayRef.current = value
      setDisplay(value)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, durationMs])

  return display
}
