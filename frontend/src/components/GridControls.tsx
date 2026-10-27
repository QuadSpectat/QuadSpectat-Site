import { cn } from '@/lib/utils'
import { GRID_COLORS, getGrid, setGrid, useGridReadout, useGridState } from '@/lib/gridFloor'
import { useStereoState } from '@/lib/anaglyph'

/**
 * Reference grid controls for the Visual panel (desktop popover and phone sheet share it): switch "Grid / רשת",
 * line spacing readout, colour swatches, Height nudge, and the "indicative only" note. The grid is only a scale aid.
 */
export function GridSwitch() {
  const g = useGridState()
  const readout = useGridReadout()
  const stereoOn = useStereoState().on
  const shown = g.on && !stereoOn
  const known = GRID_COLORS.some((c) => c.hex === g.color)
  return (
    <div className="flex flex-col gap-1.5" data-testid="grid-controls">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">
          Grid / <span dir="rtl" className="normal-case tracking-normal text-[11px]">רשת</span>
        </span>
        <div className="flex items-center gap-2">
          {shown && readout && <span data-testid="grid-readout" className="text-[11px] font-mono text-[#b8e05c]">{readout}</span>}
          <button
            type="button" role="switch" aria-checked={g.on} aria-label="Grid / רשת" data-testid="grid-switch"
            onClick={() => setGrid({ on: !g.on })}
            className={cn(
              'relative w-9 h-5 coarse:w-11 coarse:h-7 rounded-full border transition-colors before:absolute before:-inset-x-2 before:-inset-y-2 before:content-[""]',
              g.on ? 'bg-[#9ACD3C]/35 border-[#9ACD3C]/60' : 'bg-white/10 border-white/20',
            )}
          >
            <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 coarse:w-6 coarse:h-6 rounded-full bg-white shadow transition-transform', g.on && 'translate-x-4')} />
          </button>
        </div>
      </div>
      {g.on && stereoOn && (
        <span className="text-[10px] text-white/55 leading-snug" data-testid="grid-paused">
          Hidden while 3D glasses are on. <span dir="rtl">הרשת מוסתרת בזמן משקפי תלת-ממד.</span>
        </span>
      )}
      {g.on && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-white/55">Colour / <span dir="rtl">צבע</span></span>
            <span className="flex items-center gap-1.5" role="group" aria-label="Grid colour / צבע הרשת">
              {GRID_COLORS.map((c) => (
                <button
                  key={c.id} type="button" title={`${c.en} / ${c.he}`} aria-label={`${c.en} / ${c.he}`} aria-pressed={g.color === c.hex}
                  data-testid={`grid-color-${c.id}`}
                  onClick={() => setGrid({ color: c.hex })}
                  style={{ background: c.hex }}
                  className={cn('relative w-5 h-5 coarse:w-7 coarse:h-7 rounded-full border before:absolute before:-inset-1 before:content-[""]', g.color === c.hex ? 'border-[#b8e05c] ring-2 ring-[#b8e05c]/60' : 'border-white/40')}
                />
              ))}
              <label title="Custom colour / צבע אחר" className={cn('relative w-5 h-5 coarse:w-7 coarse:h-7 rounded-full border overflow-hidden cursor-pointer', !known ? 'border-[#b8e05c] ring-2 ring-[#b8e05c]/60' : 'border-white/40')}
                style={{ background: known ? 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' : g.color }}>
                <input type="color" aria-label="Custom colour / צבע אחר" data-testid="grid-color-custom" value={g.color}
                  onChange={(e) => setGrid({ color: e.target.value.toLowerCase() })} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
              </label>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-white/55">Height / <span dir="rtl">גובה</span></span>
            <span className="flex items-center gap-1">
              <button type="button" aria-label="Grid down" data-testid="grid-down" onClick={() => setGrid({ height: Math.max(-100, getGrid().height - 1) })} className="w-6 h-6 coarse:w-9 coarse:h-9 rounded-lg border border-white/20 text-white/75">-</button>
              <span data-testid="grid-height" className="text-[11px] font-mono text-[#b8e05c] min-w-[3.2rem] text-center">{g.height >= 0 ? '+' : ''}{g.height} m</span>
              <button type="button" aria-label="Grid up" data-testid="grid-up" onClick={() => setGrid({ height: Math.min(500, getGrid().height + 1) })} className="w-6 h-6 coarse:w-9 coarse:h-9 rounded-lg border border-white/20 text-white/75">+</button>
            </span>
          </div>
          <span className="text-[10px] text-white/45 leading-snug">
            Indicative scale only, local east/north metres from the model. Not a survey grid. <span dir="rtl">קנה מידה מחוון בלבד, לא רשת מדידה.</span>
          </span>
        </>
      )}
    </div>
  )
}
