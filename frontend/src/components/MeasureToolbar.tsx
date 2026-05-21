import { useRef, useEffect } from 'react'
import { Ruler, Hexagon, Box, Trash2, Home } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MeasureMode } from '@/lib/measure'

interface Props {
  mode: MeasureMode
  onModeChange: (mode: MeasureMode) => void
  baseElevation: number
  onBaseElevationChange: (v: number) => void
  result: string | null
  onResetCamera?: () => void
}

const TOOLS: { key: Exclude<MeasureMode, 'none'>; label: string; Icon: typeof Ruler }[] = [
  { key: 'distance', label: 'Distance', Icon: Ruler },
  { key: 'area',     label: 'Area',     Icon: Hexagon },
  { key: 'volume',   label: 'Volume',   Icon: Box },
]

const INSTRUCTIONS: Record<Exclude<MeasureMode, 'none'>, string> = {
  distance: 'Click to add points · Double-click to finish · Right-click to undo',
  area:     'Click to add vertices · Double-click to close · Right-click to undo',
  volume:   'Set base elevation · Click vertices · Double-click to close',
}

const PANEL = 'rounded-2xl border border-white/[0.15] bg-[#0a0e1a]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80'

export function MeasureToolbar({
  mode, onModeChange, baseElevation, onBaseElevationChange, result, onResetCamera,
}: Props) {
  const elevInputRef  = useRef<HTMLInputElement>(null)
  const elevRef       = useRef(baseElevation)
  elevRef.current     = baseElevation
  const elevChangeRef = useRef(onBaseElevationChange)
  elevChangeRef.current = onBaseElevationChange

  useEffect(() => {
    const el = elevInputRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      elevChangeRef.current(elevRef.current + (e.deltaY < 0 ? 1 : -1))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  function handleToolClick(key: Exclude<MeasureMode, 'none'>) {
    onModeChange(mode === key ? 'none' : key)
  }

  return (
    <div className="absolute top-3 right-3 z-10 flex flex-col gap-2 items-end pointer-events-none">
      {/* Tool buttons */}
      <div className={cn(PANEL, 'flex items-center gap-0.5 p-1 pointer-events-auto')}>
        {TOOLS.map(({ key, label, Icon }) => (
          <button
            key={key}
            title={label}
            onClick={() => handleToolClick(key)}
            className={cn(
              'flex items-center gap-1.5 h-8 px-2.5 rounded-xl text-xs font-medium transition-all duration-150 select-none',
              mode === key
                ? 'bg-[#86B735]/25 text-[#a3d44a] border border-[#86B735]/70 shadow-[0_0_10px_rgba(134,183,53,0.35)]'
                : 'text-white/75 hover:text-white/95 hover:bg-white/[0.08] border border-transparent',
            )}
          >
            <Icon size={13} strokeWidth={1.8} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}

        <div className="w-px h-4 bg-white/[0.20] mx-1" />

        <button
          title="Clear measurement"
          onClick={() => onModeChange('none')}
          disabled={mode === 'none' && !result}
          className="flex items-center justify-center h-8 w-8 rounded-xl text-white/60
                     hover:text-red-400 hover:bg-red-500/10 border border-transparent
                     transition-all duration-150 disabled:opacity-20 pointer-events-auto"
        >
          <Trash2 size={13} strokeWidth={1.8} />
        </button>

        {onResetCamera && (
          <>
            <div className="w-px h-4 bg-white/[0.20] mx-1" />
            <button
              title="Reset view to model"
              onClick={onResetCamera}
              className="flex items-center justify-center h-8 w-8 rounded-xl text-white/60
                         hover:text-[#a3d44a] hover:bg-[#86B735]/10 border border-transparent
                         transition-all duration-150 pointer-events-auto"
            >
              <Home size={13} strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>

      {/* Volume base elevation */}
      {mode === 'volume' && (
        <div className={cn(PANEL, 'flex items-center gap-2.5 px-3 py-2 pointer-events-auto')}>
          <label className="text-[11px] text-white/70 whitespace-nowrap tracking-wide">Base elevation</label>
          <input
            type="number"
            step="1"
            value={baseElevation}
            onChange={(e) => onBaseElevationChange(parseFloat(e.target.value) || 0)}
            ref={elevInputRef}
            className="w-20 h-6 rounded-lg border border-white/[0.20] bg-white/[0.08] px-2
                       text-xs text-white/90 text-right focus:outline-none focus:border-[#86B735]/60
                       focus:bg-[#86B735]/[0.08] transition-colors"
          />
          <span className="text-[11px] text-white/60">m</span>
        </div>
      )}

      {/* Instruction */}
      {mode !== 'none' && !result && (
        <div className={cn(PANEL, 'px-3 py-2 max-w-xs')}>
          <p className="text-[11px] text-white/70 leading-snug">{INSTRUCTIONS[mode]}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={cn(PANEL, 'px-4 py-2.5 pointer-events-auto')}>
          <p className="text-sm font-semibold text-white/95 tabular-nums">{result}</p>
          <p className="text-[11px] text-white/60 mt-0.5">Click a tool to measure again</p>
        </div>
      )}
    </div>
  )
}
