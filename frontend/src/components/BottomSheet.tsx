import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SheetTab {
  id: string
  label: string
  /** Short text shown next to the label (e.g. the latest measurement) */
  badge?: string
  icon?: ReactNode
  content: ReactNode
}

type Snap = 'collapsed' | 'half' | 'full'

/** Collapsed bar height without the safe-area inset (handle + one row of 44 px tabs). */
const BAR_PX = 68
const DRAG_THRESHOLD = 6

/**
 * Phone bottom sheet. Collapsed it is a single 68 px bar (drag handle + tab chips) that leaves the whole model visible;
 * tapping a tab or dragging the handle opens it to about half the screen, or nearly full for long lists.
 * While mounted it publishes --qs-dock-h (the collapsed bar incl. the safe-area inset) on <html> so floating map
 * controls can sit above it.
 */
export function BottomSheet({ tabs, label = 'Panels' }: { tabs: SheetTab[]; label?: string }) {
  const [snap, setSnap] = useState<Snap>('collapsed')
  const [active, setActive] = useState(tabs[0]?.id ?? '')
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight))
  const [live, setLive] = useState<number | null>(null)   // px height while dragging
  const drag = useRef<{ y: number; h: number; moved: boolean; t: number } | null>(null)
  const suppress = useRef(false)
  const safeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const on = () => setVh(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  useEffect(() => {
    const el = document.documentElement
    el.style.setProperty('--qs-dock-h', 'calc(' + BAR_PX + 'px + env(safe-area-inset-bottom))')
    return () => { el.style.removeProperty('--qs-dock-h') }
  }, [])

  // Safe-area inset in px: read from the header's padding, which is env(safe-area-inset-bottom) while collapsed
  const safeProbe = useRef(0)
  const heightFor = useCallback((s: Snap) => {
    const bar = BAR_PX + safeProbe.current
    if (s === 'collapsed') return bar
    if (s === 'half') return Math.max(bar + 140, Math.round(vh * 0.45))
    return Math.round(vh * 0.88)
  }, [vh])

  const height = live ?? heightFor(snap)
  const expanded = snap !== 'collapsed' || (live ?? 0) > heightFor('collapsed') + 8

  useEffect(() => {
    // measure env(safe-area-inset-bottom) once via a probe element
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)'
    document.body.appendChild(probe)
    const px = parseFloat(getComputedStyle(probe).paddingBottom)
    probe.remove()
    safeProbe.current = Number.isFinite(px) ? px : 0
    setVh(window.innerHeight)
  }, [])

  function pickSnap(h: number, velocity: number): Snap {
    const hs: [Snap, number][] = [['collapsed', heightFor('collapsed')], ['half', heightFor('half')], ['full', heightFor('full')]]
    const projected = h + velocity * 120   // px/ms * ms: a flick carries on a little
    return hs.reduce((best, cur) => (Math.abs(cur[1] - projected) < Math.abs(best[1] - projected) ? cur : best))[0]
  }

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { y: e.clientY, h: heightFor(snap), moved: false, t: performance.now() }
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.y
    if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD) return
    if (!d.moved) { d.moved = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
    setLive(Math.max(heightFor('collapsed'), Math.min(heightFor('full'), d.h - dy)))
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current
    drag.current = null
    if (!d || !d.moved) return
    suppress.current = true
    window.setTimeout(() => { suppress.current = false }, 60)
    const dt = Math.max(1, performance.now() - d.t)
    const velocity = -(e.clientY - d.y) / dt
    const h = live ?? d.h
    setLive(null)
    setSnap(pickSnap(h, velocity))
  }

  function onTab(id: string) {
    if (suppress.current) return
    if (snap === 'collapsed') { setActive(id); setSnap('half') }
    else if (id === active) setSnap('collapsed')
    else setActive(id)
  }

  const current = tabs.find((t) => t.id === active) ?? tabs[0]

  return (
    <section
      aria-label={label}
      data-sheet={snap}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-3xl border border-b-0 border-white/[0.15] bg-[#0b100d]/[0.98] backdrop-blur-xl',
        'shadow-[0_-12px_32px_rgba(0,0,0,0.55)] text-white',
        live === null && 'transition-[height] duration-200 ease-out',
      )}
      style={{ height, maxHeight: '92svh' }}
    >
      <div
        ref={safeRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="shrink-0 select-none cursor-grab"
        style={{ touchAction: 'none', paddingBottom: expanded ? 0 : 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/30" aria-hidden="true" />
        <div role="tablist" className="flex items-center gap-1.5 px-2 pt-1.5 pb-1.5">
          {tabs.map((t) => {
            const on = expanded && t.id === current?.id
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={on}
                onClick={() => onTab(t.id)}
                className={cn(
                  'flex-1 min-w-0 h-11 px-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 border transition-colors',
                  on ? 'bg-[#9ACD3C]/20 border-[#9ACD3C]/60 text-[#b8e05c]' : 'border-white/10 text-white/80 bg-white/[0.05] active:bg-white/[0.12]',
                )}
              >
                {t.icon}
                <span className={cn('truncate', t.badge && 'sr-only')}>{t.label}</span>
                {t.badge && <span className="truncate font-mono text-[10px] text-[#b8e05c]/90">{t.badge}</span>}
              </button>
            )
          })}
          <button
            type="button"
            aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
            aria-expanded={expanded}
            onClick={() => { if (!suppress.current) setSnap(expanded ? 'collapsed' : 'half') }}
            className="shrink-0 h-11 w-11 grid place-items-center rounded-xl text-white/70 active:bg-white/10"
          >
            <ChevronUp size={18} className={cn('transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>
      {expanded && (
        <div
          role="tabpanel"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1 flex flex-col gap-4"
          style={{ touchAction: 'pan-y', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          {current?.content}
        </div>
      )}
    </section>
  )
}
