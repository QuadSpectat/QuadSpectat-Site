import { useState } from 'react'
import { SlidersHorizontal, ChevronUp, ChevronDown, RotateCcw, Crosshair } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VisualSettings } from '@/lib/visualControls'
import { DEFAULT_VISUAL } from '@/lib/visualControls'
import { WheelSlider } from '@/components/WheelSlider'
import { useQualityMode } from '@/lib/deviceProfile'
import { usePhoneLayout } from '@/hooks/usePhoneLayout'
import { StereoPill, StereoPanelBody } from '@/components/StereoControls'

interface Props {
  settings: VisualSettings
  onChange: (s: VisualSettings) => void
  onSnapToGround?: () => void
  /** Short label showing current model CRS, e.g. "ITM -17.5 m" */
  crsLabel?: string
  /** Owner only: Align to Google 3D block (given while Google 3D is on and a model is open) */
  googleAlign?: GoogleAlignUi
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


/** Owner-only "Align to Google 3D" block of the Visual panel (shown while Google 3D is on and a model is open). */
export interface GoogleAlignUi {
  /** saved google_offset of the open model, metres */
  offset: number
  /** one line about the last measurement, or an error text */
  info: string | null
  busy: boolean
  onAlign: () => void
  onNudge: (deltaMetres: number) => void
  onReset: () => void
}

function GoogleAlignBlock({ ui }: { ui: GoogleAlignUi }) {
  const nudge = [-1, -0.1, 0.1, 1]
  const btnCls = 'h-7 coarse:h-11 px-2 rounded-lg text-[11px] font-medium border border-white/[0.15] text-white/75 hover:text-white hover:bg-white/[0.07] select-none disabled:opacity-40'
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-sky-400/30 bg-sky-400/[0.05] p-2.5" data-testid="google-align">
      <span className="text-[10px] font-semibold tracking-widest uppercase text-sky-300/90">
        <span dir="rtl">יישור ל-Google 3D</span> / Align to Google 3D
      </span>
      <p className="text-[10px] leading-snug text-white/55">
        <span dir="rtl" className="block">מודד את גובה הקרקע של Google ושל המודל באתר ומזיז את המודל עד שהוא יושב על Google. התיקון נשמר למודל ופועל רק כש-Google 3D פעיל; התצוגה הרגילה לא משתנה.</span>
        Measures Google&apos;s ground and the model&apos;s ground at the site and moves the model until it sits on Google. The correction is saved with the model and applies only while Google 3D is on; the normal view does not change.
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={ui.busy} onClick={ui.onAlign} data-testid="google-align-run" className={cn(btnCls, 'flex-1 border-sky-400/40 text-sky-200')}>
          {ui.busy ? '…' : 'Align / יישר'}
        </button>
        <button type="button" disabled={ui.busy} onClick={ui.onReset} data-testid="google-align-reset" className={btnCls}>Reset / איפוס</button>
      </div>
      <div className="flex items-center justify-between gap-1">
        {nudge.map((d) => (
          <button key={d} type="button" disabled={ui.busy} onClick={() => ui.onNudge(d)} data-testid={`google-nudge-${d}`} className={btnCls}>{d > 0 ? '+' : ''}{d}</button>
        ))}
      </div>
      <span className="text-[11px] font-mono text-sky-200" data-testid="google-align-offset">Google offset {ui.offset >= 0 ? '+' : ''}{ui.offset.toFixed(2)} m</span>
      {ui.info && <span className="text-[10px] text-white/55 leading-snug" data-testid="google-align-info">{ui.info}</span>}
    </div>
  )
}

/** Light mode / High quality switch. Phones start in Light mode; the choice is remembered on this device. */
export function QualityModeToggle() {
  const [mode, setMode] = useQualityMode()
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">Performance</span>
      <div role="group" aria-label="Performance mode" className="flex rounded-xl overflow-hidden border border-white/[0.15]">
        {([['light', 'Light mode'], ['high', 'High quality']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              'flex-1 h-9 coarse:h-11 px-2 text-xs font-medium select-none transition-colors',
              mode === m ? 'bg-[#9ACD3C]/25 text-[#b8e05c]' : 'text-white/65 hover:text-white/90 hover:bg-white/[0.07]',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="text-[10px] text-white/45 leading-snug">
        {mode === 'light'
          ? 'Lighter on battery and memory. Sharper detail loads as you zoom in.'
          : 'Sharper and smoother, uses more battery and memory.'}
      </span>
    </div>
  )
}

/** Performance switch + sliders. Rendered inside the floating panel on large screens and inside the bottom sheet on phones. */
export function VisualPanelBody({ settings, onChange, onSnapToGround, crsLabel, googleAlign }: Props) {
  function set(key: keyof VisualSettings, value: number) {
    onChange({ ...settings, [key]: value })
  }

  const isDefault = (Object.keys(DEFAULT_VISUAL) as (keyof VisualSettings)[]).every(
    (k) => settings[k] === DEFAULT_VISUAL[k],
  )

  return (
    <>
      <QualityModeToggle />
      {SLIDERS.map(({ key, label, min, max, step, format }) => {
        const val = settings[key]
        const pct = ((val - min) / (max - min)) * 100
        const isMidRange = min < 0
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">{label}</span>
              <span className="text-[11px] font-mono text-[#b8e05c]">{format(val)}</span>
            </div>
            <div className="relative h-4 flex items-center group/sl">
              <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.18]" />
              {isMidRange ? (
                <div
                  className="absolute h-[3px] rounded-full bg-[#9ACD3C]/80"
                  style={{ left: pct >= 50 ? '50%' : `${pct}%`, width: `${Math.abs(pct - 50)}%` }}
                />
              ) : (
                <div className="absolute left-0 h-[3px] rounded-full bg-[#9ACD3C]/90" style={{ width: `${pct}%` }} />
              )}
              <div
                className="absolute w-[13px] h-[13px] rounded-full bg-white shadow-md shadow-black/60 ring-[1.5px] ring-black/40 pointer-events-none group-hover/sl:scale-[1.2] transition-transform duration-100"
                style={{ left: `calc(${pct}% - 6.5px)` }}
              />
              <WheelSlider
                min={min} max={max} step={step} value={val}
                onChange={(v) => set(key, v)}
                className="absolute inset-x-0 opacity-0 h-4 coarse:h-9 w-full cursor-pointer"
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
                    className="flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[10px] font-medium border border-[#9ACD3C]/40 text-[#9ACD3C]/80 hover:text-[#b8e05c] hover:border-[#9ACD3C]/70 hover:bg-[#9ACD3C]/15 transition-all duration-150"
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
      {googleAlign && <GoogleAlignBlock ui={googleAlign} />}
      {!isDefault && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_VISUAL)}
          className="flex items-center justify-center gap-2 h-7 coarse:h-11 text-[11px] rounded-xl border border-white/[0.15] text-white/50 hover:text-white/80 hover:border-white/30 hover:bg-white/[0.06] transition-all duration-150"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          Reset all
        </button>
      )}
    </>
  )
}

export function VisualControls({ settings, onChange, onSnapToGround, crsLabel, googleAlign }: Props) {
  const [panel, setPanel] = useState<'visual' | 'stereo' | null>(null)   // one popover at a time
  const open = panel === 'visual'
  const phone = usePhoneLayout()
  if (phone) return null   // phones get these controls in the bottom sheet

  return (
    // flex-col-reverse: first child (button) sits at physical bottom, second child (panel) grows upward
    <div className="qs-keep absolute bottom-[calc(2.5rem+env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-30 flex flex-col-reverse items-start gap-2">
      {/* Toggle buttons - rendered FIRST so they sit at the bottom */}
      {/* side by side; stacked on mid-size screens so the 3D button never covers the measuring dock */}
      <div className="flex items-center gap-2 max-[959px]:flex-col-reverse max-[959px]:items-start">
      <button
        type="button"
        onClick={() => setPanel(open ? null : 'visual')}
        className={cn(
          'qs-chrome flex items-center gap-2 h-8 coarse:h-11 px-3 rounded-xl text-xs font-medium select-none',
          'bg-[#090d0b]/80 backdrop-blur-md border shadow-lg transition-all duration-200',
          open
            ? 'border-[#9ACD3C]/50 text-[#b8e05c] shadow-[#9ACD3C]/10'
            : 'border-white/15 text-white/75 hover:text-white/95 hover:border-white/25',
        )}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span>Visual</span>
        {open ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
      </button>
      <StereoPill open={panel === 'stereo'} onToggleOpen={() => setPanel(panel === 'stereo' ? null : 'stereo')} />
      </div>

      {/* Panel - rendered SECOND so it appears above the button */}
      {open && (
        <div className="qs-chrome w-64 max-h-[calc(100dvh-20rem)] min-h-[12rem] overflow-y-auto rounded-2xl border border-white/[0.15] bg-[#0b100d]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 p-4 flex flex-col gap-4">
          <VisualPanelBody settings={settings} onChange={onChange} onSnapToGround={onSnapToGround} crsLabel={crsLabel} googleAlign={googleAlign} />
        </div>
      )}
      {panel === 'stereo' && (
        <div className="qs-chrome w-64 max-h-[calc(100dvh-20rem)] min-h-[12rem] overflow-y-auto rounded-2xl border border-white/[0.15] bg-[#0b100d]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 p-4 flex flex-col gap-4">
          <StereoPanelBody />
        </div>
      )}
    </div>
  )
}
