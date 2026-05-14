import { useState } from 'react'
import { SlidersHorizontal, ChevronUp, ChevronDown, RotateCcw, Crosshair } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VisualSettings } from '@/lib/visualControls'
import { DEFAULT_VISUAL } from '@/lib/visualControls'
import { WheelSlider } from '@/components/WheelSlider'

interface Props {
  settings: VisualSettings
  onChange: (s: VisualSettings) => void
  onSnapToGround?: () => void
  /** Short label showing current model CRS, e.g. "ITM -17.5 m" */
  crsLabel?: string
}

interface SliderDef {
  key: keyof VisualSettings
  label: string
  min: number
  max: number
  step: number
  format: (v: number) => string
}

const SLIDERS: SliderDef[] = [
  { key: 'quality', label: 'Detail', min: 1, max: 100, step: 1, format: (v) => `${v}%` },
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.1, format: (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + ' EV' },
  { key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, format: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.05, format: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
  { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.05, format: (v) => v > 0 ? `+${v.toFixed(2)} warm` : v < 0 ? `${v.toFixed(2)} cool` : '0 neutral' },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.05, format: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
  { key: 'heightOffset', label: 'Height Offset', min: -500, max: 500, step: 1, format: (v) => (v >= 0 ? '+' : '') + v.toFixed(0) + ' m' },
]

export function VisualControls({ settings, onChange, onSnapToGround, crsLabel }: Props) {
  const [open, setOpen] = useState(false)

  function set(key: keyof VisualSettings, value: number) {
    onChange({ ...settings, [key]: value })
  }

  const isDefault = (Object.keys(DEFAULT_VISUAL) as (keyof VisualSettings)[]).every(
    (k) => settings[k] === DEFAULT_VISUAL[k],
  )

  return (
    // flex-col-reverse: first child (button) sits at physical bottom, second child (panel) grows upward
    <div className="absolute bottom-4 left-4 z-10 flex flex-col-reverse items-start gap-2">
      {/* Toggle button - rendered FIRST so it sits at the bottom */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 h-8 px-3 rounded-xl text-xs font-medium select-none',
          'bg-[#080c18]/80 backdrop-blur-md border shadow-lg transition-all duration-200',
          open
            ? 'border-[#86B735]/50 text-[#a3d44a] shadow-[#86B735]/10'
            : 'border-white/15 text-white/75 hover:text-white/95 hover:border-white/25',
        )}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span>Visual</span>
        {open ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
      </button>

      {/* Panel - rendered SECOND so it appears above the button */}
      {open && (
        <div className="w-64 rounded-2xl border border-white/[0.15] bg-[#0a0e1a]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 p-4 flex flex-col gap-4">
          {SLIDERS.map(({ key, label, min, max, step, format }) => {
            const val = settings[key]
            const pct = ((val - min) / (max - min)) * 100
            const isMidRange = min < 0
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">{label}</span>
                  <span className="text-[11px] font-mono text-[#a3d44a]">{format(val)}</span>
                </div>
                <div className="relative h-4 flex items-center group/sl">
                  <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.18]" />
                  {isMidRange ? (
                    <div
                      className="absolute h-[3px] rounded-full bg-[#86B735]/80"
                      style={{ left: pct >= 50 ? '50%' : `${pct}%`, width: `${Math.abs(pct - 50)}%` }}
                    />
                  ) : (
                    <div className="absolute left-0 h-[3px] rounded-full bg-[#86B735]/90" style={{ width: `${pct}%` }} />
                  )}
                  <div
                    className="absolute w-[13px] h-[13px] rounded-full bg-white shadow-md shadow-black/60 ring-[1.5px] ring-black/40 pointer-events-none group-hover/sl:scale-[1.2] transition-transform duration-100"
                    style={{ left: `calc(${pct}% - 6.5px)` }}
                  />
                  <WheelSlider
                    min={min} max={max} step={step} value={val}
                    onChange={(v) => set(key, v)}
                    className="absolute inset-x-0 opacity-0 h-4 w-full cursor-pointer"
                  />
                </div>
                {key === 'heightOffset' && (crsLabel || onSnapToGround) && (
                  <div className="flex items-center gap-2 mt-0.5">
                    {crsLabel && (
                      <span className="text-[10px] text-white/45 flex-1 truncate font-mono">base {crsLabel}</span>
                    )}
                    {onSnapToGround && (
                      <button
                        type="button"
                        onClick={onSnapToGround}
                        title="Auto-detect ground level and apply correction"
                        className="flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[10px] font-medium border border-[#86B735]/40 text-[#86B735]/80 hover:text-[#a3d44a] hover:border-[#86B735]/70 hover:bg-[#86B735]/15 transition-all duration-150"
                      >
                        <Crosshair className="w-2.5 h-2.5" />
                        Snap to ground
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {!isDefault && (
            <button
              type="button"
              onClick={() => onChange(DEFAULT_VISUAL)}
              className="flex items-center justify-center gap-2 h-7 text-[11px] rounded-xl border border-white/[0.15] text-white/50 hover:text-white/80 hover:border-white/30 hover:bg-white/[0.06] transition-all duration-150"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
