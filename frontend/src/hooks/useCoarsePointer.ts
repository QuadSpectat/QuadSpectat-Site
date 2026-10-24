import { useEffect, useState } from 'react'

const QUERY = '(pointer: coarse)'

/** True when the primary pointer is a finger (phones, most tablets): no right-click, no hover, no reliable double-click. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return
    const on = () => setCoarse(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return coarse
}
