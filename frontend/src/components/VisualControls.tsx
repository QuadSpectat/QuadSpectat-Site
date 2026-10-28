import { useState } from 'react'
import { SlidersHorizontal, ChevronUp, ChevronDown, RotateCcw, Crosshair } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VisualSettings } from '@/lib/visualControls'
import { DEFAULT_VISUAL } from '@/lib/visualControls'
import { WheelSlider } from '@/components/WheelSlider'
import { useQualityMode } from '@/lib/deviceProfile'
import { usePhoneLayout } from '@/hooks/usePhoneLayout'
import { StereoPill, StereoPanelBody } from '@/components/StereoControls'
import { GridSwitch } from '@/components/GridControls'

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
  /** the honest residual report of the last alignment, one item per line */
  lines: string[]
  busy: boolean
  /** Align at point(s): the owner is choosing ground spots, how many so far */
  pickMode: boolean
  pickCount: number
  onTogglePick: () => void
  /** unsaved manual height change made while Google 3D is shown (the nudges / Height Offset slider), metres */
  pending: number
  onSaveManual: () => void
  /** Cut out Google under the model */
  cutout: { on: boolean; auto: boolean; margin: number; status: string | null; onToggle: (on: boolean) => void; onMargin: (v: number) => void }
  /** primary: Clear Google fit (never hidden under Google) */
  onAlign: () => void
  /** secondary: centred best-average fit */
  onAlignCentred: () => void
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
        <span dir="rtl" className="block">הגובה של המודל מותאם ל-Google רק כש-Google 3D פעיל (התצוגה הרגילה לא משתנה). המודל לא מוטה, רק מוגבה או מונמך.</span>
        Moves the model up or down so it sits on Google. Saved with the model and applied only while Google 3D is on; the normal view does not change. The model is never tilted.
      </p>
      <details className="text-[10px] leading-snug text-white/55" data-testid="google-align-help">
        <summary className="cursor-pointer text-sky-200/90 select-none">Why it may not fit everywhere / למה זה לא מתאים בכל מקום</summary>
        <p className="mt-1">
          <span dir="rtl" className="block">המודל שלכם ו-Google הם שני מדידות שונות. הם נבדלים במקומות: גשרים, בניינים ועצים קיימים אצל Google, לשני המשטחים יש שגיאות גובה של מטרים, ולעיתים יש ביניהם הטיה קלה. גובה אחד לא יכול להתאים בכל מקום. לכן יישרו במקום שמודדים בו: &quot;יישור בנקודה&quot; מתאים בדיוק במקום שלחצתם, ו&quot;יישור כולל&quot; בוחר את הגובה הטוב ביותר לכל השטח ומציג כמה הוא שגוי בכל צד.</span>
          The model and Google are two different surveys. They differ in places: bridges, buildings and trees are in Google, both surfaces have height errors of a few metres, and there can be a slight tilt between them. One height cannot fit everywhere. So align where you measure: &quot;Align at point&quot; fits exactly where you click, and &quot;Align overall&quot; picks the best single height for the whole area and tells you how far off it is on each side.
        </p>
      </details>
      <button type="button" disabled={ui.busy} onClick={ui.onAlign} data-testid="google-align-run" className={cn(btnCls, 'h-9 coarse:h-11 border-sky-400/50 text-sky-100 bg-sky-400/10 font-semibold')}>
        {ui.busy ? '…' : 'Align to Google 3D / יישור ל-Google 3D'}
      </button>
      <p className="text-[10px] leading-snug text-white/55" data-testid="google-align-clear-help">
        <span dir="rtl" className="block">ברירת מחדל (&quot;מעל Google&quot;): המודל תמיד מעל Google ולא נעלם, אבל במקומות מסוימים הוא עשוי לצוף מעליו.</span>
        Default (&quot;Clear Google&quot;): the model is always above Google and never hidden, but may float above it in places.
      </p>
      <button type="button" disabled={ui.busy} onClick={ui.onAlignCentred} data-testid="google-align-centred" className={btnCls}>Align overall (centred) / יישור כולל (ממורכז)</button>
      <p className="text-[10px] leading-snug text-white/55">
        <span dir="rtl" className="block">הגובה הממוצע הטוב ביותר: הכי קרוב ל-Google בממוצע, אבל במקומות מסוימים המודל עלול לשקוע מתחתיו.</span>
        Best average fit: closest to Google on average, but the model may sink below it in places.
      </p>
      <button type="button" disabled={ui.busy} onClick={ui.onTogglePick} aria-pressed={ui.pickMode} data-testid="google-align-point"
        className={cn(btnCls, ui.pickMode && 'border-cyan-300/60 text-cyan-200 bg-cyan-400/10')}>
        {ui.pickMode ? `Done / סיום (${ui.pickCount})` : 'Align at point / יישור בנקודה'}
      </button>
      <p className="text-[10px] leading-snug text-white/55">
        <span dir="rtl" className="block">מדויק בנקודה שלחצתם על המודל, ופחות מדויק במקומות אחרים.</span>
        Exact at the spot you click on the model, less exact elsewhere.
      </p>
      {ui.pickMode && (
        <p className="text-[10px] leading-snug text-cyan-200/90" data-testid="google-align-point-help">
          <span dir="rtl" className="block">לחצו על נקודת קרקע במודל (אפשר כמה נקודות: הגובה יהיה הממוצע שלהן).</span>
          Click a ground spot on the model (you can add several: the offset is their average).
        </p>
      )}
      <button type="button" disabled={ui.busy} onClick={ui.onReset} data-testid="google-align-reset" className={btnCls}>Reset / איפוס</button>
      <div className="flex items-center justify-between gap-1">
        {nudge.map((d) => (
          <button key={d} type="button" disabled={ui.busy} onClick={() => ui.onNudge(d)} data-testid={`google-nudge-${d}`} className={btnCls}>{d > 0 ? '+' : ''}{d}</button>
        ))}
      </div>
      <span className="text-[11px] font-mono text-sky-200" data-testid="google-align-offset">Google offset {ui.offset >= 0 ? '+' : ''}{ui.offset.toFixed(2)} m</span>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-white/70" data-testid="google-align-pending">Unsaved manual change {ui.pending >= 0 ? '+' : ''}{ui.pending.toFixed(2)} m</span>
        <button type="button" disabled={ui.busy || Math.abs(ui.pending) < 0.005} onClick={ui.onSaveManual} data-testid="google-align-save" className={btnCls}>Save as Google offset / שמור</button>
      </div>
      <p className="text-[10px] leading-snug text-white/55" data-testid="google-align-manual-help">
        <span dir="rtl" className="block">הקרקע של Google יכולה להיות לא מדויקת (רזולוציה נמוכה, שיפוע שגוי). המודל שלכם הוא ההתייחסות: התאימו ידנית בכפתורי + / - או בסרגל Height Offset ושמרו. הכפתורים האוטומטיים רק עוזרים.</span>
        Google&apos;s ground can be inaccurate (low resolution, wrong slope). Your model is the reference: adjust by hand with the +/- buttons or the Height Offset slider, then save. The automatic buttons are only helpers.
      </p>
      <div className="flex flex-col gap-1.5 border-t border-sky-400/20 pt-2" data-testid="google-cutout">
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input type="checkbox" data-testid="google-cutout-toggle" checked={ui.cutout.on} onChange={(e) => ui.cutout.onToggle(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
          <span className="text-[11px] text-sky-100 font-medium"><span dir="rtl">חתוך את גוגל מתחת למודל</span> / Cut out Google under the model{ui.cutout.auto ? ' (automatic: on because the model is aligned)' : ''}</span>
        </label>
        <p className="text-[10px] leading-snug text-white/55">
          <span dir="rtl" className="block">גוגל נחתך בקו קשיח לפי שטח המודל, כך שהקרקע של המודל מחליפה את הקרקע המטושטשת של גוגל, וגוגל נשאר כרקע מסביב. החיתוך אופקי: ההיסט של גוגל מזיז את המודל רק למעלה/למטה.</span>
          Google is cut out along the model&apos;s footprint (hard edge), so the model&apos;s own ground replaces Google&apos;s blurry ground and Google stays around it. The cut is horizontal: the Google offset only moves the model up or down.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/60 shrink-0"><span dir="rtl">שוליים</span> / Margin</span>
          <input type="range" min={-20} max={50} step={1} value={ui.cutout.margin} data-testid="google-cutout-margin" disabled={!ui.cutout.on}
            onChange={(e) => ui.cutout.onMargin(Number(e.target.value))} className="flex-1 accent-sky-300" />
          <span className="text-[11px] font-mono text-sky-200 w-14 text-right" data-testid="google-cutout-margin-value">{ui.cutout.margin >= 0 ? '+' : ''}{ui.cutout.margin} m</span>
        </div>
        {ui.cutout.status && <span className="text-[10px] text-white/60 leading-snug" data-testid="google-cutout-status">{ui.cutout.status}</span>}
      </div>
      {ui.info && <span className="text-[10px] text-white/70 leading-snug" data-testid="google-align-info">{ui.info}</span>}
      {ui.lines.length > 0 && (
        <ul className="text-[10px] text-white/60 leading-snug list-disc pl-3.5" data-testid="google-align-report">
          {ui.lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
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
      <GridSwitch />
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
