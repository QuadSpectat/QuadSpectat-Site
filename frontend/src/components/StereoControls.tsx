import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Glasses, ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WheelSlider } from '@/components/WheelSlider'
import { detectDevice } from '@/lib/deviceProfile'
import { SEP_MAX, SEP_MIN, T, bi, setStereo, useStereoState } from '@/lib/anaglyph'
import type { TextKey } from '@/lib/anaglyph'

/** Label with both languages, Hebrew first. bdi keeps the two scripts from reordering each other. */
function Bi({ k }: { k: TextKey }) {
  return <><bdi>{T[k].he}</bdi> / <bdi>{T[k].en}</bdi></>
}

/** Hebrew line (right to left) above its English line. */
function Note({ he, en, className }: { he: string; en: string; className?: string }) {
  return (
    <p className={cn('text-[10px] text-white/45 leading-snug flex flex-col gap-0.5', className)}>
      <span dir="rtl">{he}</span>
      <span dir="ltr">{en}</span>
    </p>
  )
}

/** Same look as the Visual sliders; always left-to-right so the thumb moves the way the number grows. */
function SliderRow({ label, value, min, max, step, text, onChange, }: {
  label: TextKey; value: number; min: number; max: number; step: number; text: string; onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div dir="ltr" className={'flex flex-col gap-1.5'}>
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60"><Bi k={label} /></span>
        <span className="text-[11px] font-mono text-[#b8e05c]">{text}</span>
      </div>
      <div className="relative h-4 flex items-center group/sl">
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.18]" />
        <div className="absolute left-0 h-[3px] rounded-full bg-[#9ACD3C]/90" style={{ width: `${pct}%` }} />
        <div
          className="absolute w-[13px] h-[13px] rounded-full bg-white shadow-md shadow-black/60 ring-[1.5px] ring-black/40 pointer-events-none"
          style={{ left: `calc(${pct}% - 6.5px)` }}
        />
        <WheelSlider
          min={min} max={max} step={step} value={value} onChange={onChange}
          className="absolute inset-x-0 opacity-0 h-4 coarse:h-9 w-full cursor-pointer"
        />
      </div>
    </div>
  )
}

function Choice({ options, value, onPick, label }: { options: [string, TextKey][]; value: string; onPick: (v: string) => void; label: TextKey }) {
  return (
    <div role="group" aria-label={T[label].en} className="flex rounded-xl overflow-hidden border border-white/[0.15]">
      {options.map(([v, k]) => (
        <button
          key={v} type="button" aria-pressed={value === v} onClick={() => onPick(v)}
          className={cn(
            'flex-1 h-9 coarse:h-11 px-2 text-xs font-medium select-none transition-colors',
            value === v ? 'bg-[#9ACD3C]/25 text-[#b8e05c]' : 'text-white/65 hover:text-white/90 hover:bg-white/[0.07]',
          )}
        ><Bi k={k} /></button>
      ))}
    </div>
  )
}

/**
 * Small calibration picture for the red/cyan glasses. Honours Swap: the red image is the one for the eye that has the red
 * lens (left by default). Top row: one red and one cyan patch (each must look bright through its own lens and dark through the
 * other). Bottom: a frame drawn red and cyan with crossed parallax, which must float in front of the page.
 */
function TestImage({ swap, onClose }: { swap: boolean; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current?.getContext('2d')
    if (!c) return
    c.fillStyle = '#000'; c.fillRect(0, 0, 480, 300)
    c.font = 'bold 20px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
    for (const [x, col, txt] of [[70, '#ff0000', swap ? 'R' : 'L'], [310, '#00ffff', swap ? 'L' : 'R']] as const) {
      c.fillStyle = col; c.fillRect(x, 20, 100, 70)
      c.fillStyle = '#000'; c.fillText(txt, x + 50, 55)
    }
    c.globalCompositeOperation = 'lighter'
    c.lineWidth = 5
    const d = swap ? -7 : 7   // red image to the right of the cyan one = in front of the page (red lens on the left eye)
    c.strokeStyle = '#ff0000'; c.strokeRect(165 + d, 135, 150, 120)
    c.strokeStyle = '#00ffff'; c.strokeRect(165 - d, 135, 150, 120)
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = '#888'; c.font = '12px sans-serif'
    c.fillText('+', 240, 195)
  }, [swap])
  return createPortal(
    <div role="dialog" aria-label={T.test.en} className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-3" onClick={onClose}>
      <div className="max-w-[520px] w-full rounded-2xl border border-white/[0.15] bg-[#0b100d] p-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center text-xs font-semibold text-white/80">
          <span><Bi k="test" /></span>
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-lg border border-white/20 text-white/70 hover:text-white"><Bi k="close" /></button>
        </div>
        <canvas ref={ref} width={480} height={300} className="w-full rounded-lg" />
        <Note he={swap ? T.testPatchesSwapped.he : T.testPatches.he} en={swap ? T.testPatchesSwapped.en : T.testPatches.en} />
        <Note he={T.testFloat.he} en={T.testFloat.en} />
      </div>
    </div>,
    document.body,
  )
}

/** Settings of the red/cyan 3D mode. Desktop popover and phone bottom-sheet tab share it (like VisualPanelBody). */
export function StereoPanelBody() {
  const st = useStereoState()
  const [test, setTest] = useState(false)
  const reason = st.blocked
  const phone = detectDevice().phone
  const off = !!reason
  const showOn = st.on && !off
  return (
    <>
      <button
        type="button" disabled={off} aria-pressed={showOn} onClick={() => setStereo({ on: !st.on })}
        className={cn(
          'h-9 coarse:h-11 rounded-xl text-xs font-semibold select-none border transition-colors',
          off ? 'border-white/10 text-white/30 cursor-not-allowed'
            : showOn ? 'border-[#9ACD3C]/60 bg-[#9ACD3C]/25 text-[#b8e05c]' : 'border-white/[0.15] text-white/75 hover:bg-white/[0.07]',
        )}
      >
        <Bi k="title" />: <Bi k={showOn ? (st.paused ? 'paused' : 'on') : 'off'} />
      </button>
      {reason && <Note he={T[reason].he} en={T[reason].en} className="text-amber-200/80" />}
      <div className={cn('flex flex-col gap-4', off && 'opacity-40 pointer-events-none')}>
        <SliderRow label="depth" value={st.sep} min={SEP_MIN} max={SEP_MAX} step={0.1}
          text={st.sep === 0 ? 'flat' : st.sep.toFixed(1)} onChange={(v) => setStereo({ sep: v })} />
        <SliderRow label="pop" value={st.pop} min={0} max={4} step={0.05}
          text={`${Math.round(st.pop * 100)}%`} onChange={(v) => setStereo({ pop: v })} />
        <SliderRow label="ghost" value={st.ghost} min={0} max={1} step={0.05}
          text={`${Math.round(st.ghost * 100)}%`} onChange={(v) => setStereo({ ghost: v })} />
        <div className="flex gap-2">
          <button
            type="button" aria-pressed={st.swap} onClick={() => setStereo({ swap: !st.swap })}
            className={cn('flex-1 h-8 coarse:h-11 rounded-lg text-[11px] border select-none', st.swap ? 'border-[#9ACD3C]/50 text-[#b8e05c] bg-[#9ACD3C]/15' : 'border-white/[0.15] text-white/70')}
          ><Bi k="swap" /></button>
          <button
            type="button" onClick={() => setTest(true)}
            className="flex-1 h-8 coarse:h-11 rounded-lg text-[11px] border border-white/[0.15] text-white/70 select-none"
          ><Bi k="test" /></button>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60"><Bi k="look" /></span>
          <Choice label="look" value={st.comfort ? 'comfort' : 'colour'} onPick={(v) => setStereo({ comfort: v === 'comfort' })}
            options={[['colour', 'colour'], ['comfort', 'comfort']]} />
        </div>
      </div>
      <Note he={`${st.swap ? T.lensRight.he : T.lensLeft.he} ${T.safety.he}`} en={`${st.swap ? T.lensRight.en : T.lensLeft.en} ${T.safety.en}`} />
      {st.flatMap && <Note he={T.flat.he} en={T.flat.en} />}
      {phone && <Note he={T.phone.he} en={T.phone.en} />}
      {test && <TestImage swap={st.swap} onClose={() => setTest(false)} />}
    </>
  )
}

/** Desktop button beside Visual: the left part switches 3D on/off, the chevron opens the settings. */
export function StereoPill({ open, onToggleOpen }: { open: boolean; onToggleOpen: () => void }) {
  const st = useStereoState()
  const blocked = st.blocked
  const showOn = st.on && !blocked
  return (
    <div
      className={cn(
        'flex items-center h-8 coarse:h-11 rounded-xl text-xs font-medium select-none overflow-hidden',
        'bg-[#090d0b]/80 backdrop-blur-md border shadow-lg transition-all duration-200',
        open || showOn ? 'border-[#9ACD3C]/50 text-[#b8e05c] shadow-[#9ACD3C]/10' : 'border-white/15 text-white/75',
        blocked && 'opacity-50',
        st.paused && 'opacity-70',
      )}
    >
      <button
        type="button" disabled={!!blocked} aria-pressed={showOn} onClick={() => setStereo({ on: !st.on })}
        aria-label="3D glasses" title={blocked ? bi(blocked) : bi('title')}
        className="flex items-center gap-2 h-full pl-3 pr-2 hover:text-white/95 disabled:cursor-not-allowed"
      >
        <Glasses className="w-3.5 h-3.5" />
        <span>3D</span>
        <span className={cn('w-2 h-2 rounded-full', showOn ? 'bg-[#9ACD3C]' : 'bg-white/25')} />
        {st.paused && <span className="text-[10px] opacity-80"><Bi k="paused" /></span>}
      </button>
      <button type="button" aria-label="3D settings" aria-expanded={open} onClick={onToggleOpen} className="h-full px-2 hover:text-white/95">
        {open ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
      </button>
    </div>
  )
}
