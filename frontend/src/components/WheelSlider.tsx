import { useRef, useEffect } from 'react'

interface Props {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  className?: string
}

/**
 * range <input> that also responds to mouse-wheel for fine adjustment.
 * Uses a non-passive wheel listener attached directly to the DOM element
 * (React's synthetic onWheel is passive and cannot call preventDefault).
 */
export function WheelSlider({ value, onChange, min, max, step, className }: Props) {
  const inputRef   = useRef<HTMLInputElement>(null)
  const valueRef   = useRef(value)
  const changeRef  = useRef(onChange)
  const stepRef    = useRef(step)
  const minRef     = useRef(min)
  const maxRef     = useRef(max)

  // Keep refs current without re-attaching the listener
  valueRef.current  = value
  changeRef.current = onChange
  stepRef.current   = step
  minRef.current    = min
  maxRef.current    = max

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const dir = e.deltaY < 0 ? 1 : -1
      const s   = stepRef.current
      const raw = valueRef.current + dir * s
      // snap to nearest step, then clamp
      const snapped = Math.round(raw / s) * s
      const clamped = Math.max(minRef.current, Math.min(maxRef.current, snapped))
      changeRef.current(parseFloat(clamped.toFixed(10)))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, []) // stable — all live values read through refs

  return (
    <input
      ref={inputRef}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={className}
    />
  )
}
