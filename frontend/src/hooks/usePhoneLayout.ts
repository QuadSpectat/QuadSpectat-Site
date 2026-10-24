import { useEffect, useState } from 'react'
import { PHONE_LAYOUT_QUERY } from '@/lib/deviceProfile'

/** True when panels should live in the bottom sheet (<= 640 px wide, or a finger below the lg breakpoint). */
export function usePhoneLayout(): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_LAYOUT_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_LAYOUT_QUERY)
    if (!mq) return
    const f = () => setOn(mq.matches)
    f()
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return on
}
