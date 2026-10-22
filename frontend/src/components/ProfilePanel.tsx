import { useMemo, useState } from 'react'
import { Download, X } from 'lucide-react'
import type { Profile } from '@/lib/profile'
import { profileStats, profileToCsv, validRuns } from '@/lib/profile'
import { formatDistance } from '@/lib/measure'

interface Props {
  profile: Profile
  onClose: () => void
}

const W = 520, H = 190
const PAD = { l: 46, r: 10, t: 10, b: 24 }

function niceStep(range: number): number {
  const raw = range / 4
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / pow
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow
}

function download(profile: Profile) {
  const blob = new Blob([profileToCsv(profile)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'profile.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/** Distance vs height-above-sea-level chart for a sampled line, with CSV export. Plain SVG, touch friendly. */
export function ProfilePanel({ profile, onClose }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const st = useMemo(() => profileStats(profile.samples), [profile])

  const geo = useMemo(() => {
    if (!st) return null
    const pad = Math.max(0.5, (st.max - st.min) * 0.1)
    const lo = st.min - pad, hi = st.max + pad
    const step = niceStep(hi - lo)
    const ticks: number[] = []
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)
    const x = (d: number) => PAD.l + (profile.length > 0 ? (d / profile.length) * (W - PAD.l - PAD.r) : 0)
    const y = (h: number) => PAD.t + (1 - (h - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
    return { ticks, x, y }
  }, [st, profile.length])

  if (!st || !geo) return null
  const { ticks, x, y } = geo
  const runs = validRuns(profile.samples)
  const hover = hoverIdx !== null ? profile.samples[hoverIdx] : null

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const t = (px - PAD.l) / (W - PAD.l - PAD.r)
    const i = Math.round(Math.min(1, Math.max(0, t)) * (profile.samples.length - 1))
    setHoverIdx(i)
  }

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 w-[min(34rem,calc(100%-1.5rem))]
                    rounded-2xl border border-white/[0.15] bg-[#0b100d]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80
                    px-3 py-2.5 pointer-events-auto">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-white/50">
          Profile · {formatDistance(profile.length)}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => download(profile)} title="Export CSV" aria-label="Export profile as CSV"
            className="flex items-center gap-1 h-8 px-2 rounded-xl text-[11px] font-medium text-white/75
                       hover:text-white/95 hover:bg-white/[0.08] border border-white/[0.12] transition-all">
            <Download size={12} />CSV
          </button>
          <button onClick={onClose} title="Close profile" aria-label="Close profile"
            className="flex items-center justify-center h-8 w-8 rounded-xl text-white/60 hover:text-white/95
                       hover:bg-white/[0.08] border border-transparent transition-all">
            <X size={14} />
          </button>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto touch-none select-none"
           onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHoverIdx(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="white" strokeOpacity={0.1} />
            <text x={PAD.l - 5} y={y(t) + 3} textAnchor="end" fontSize={10} fill="white" fillOpacity={0.55}>
              {t.toFixed(t % 1 === 0 ? 0 : 1)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} fontSize={10} fill="white" fillOpacity={0.55}>0 m</text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize={10} fill="white" fillOpacity={0.55}>
          {formatDistance(profile.length)}
        </text>
        {runs.map((run, i) =>
          run.length === 1 ? (
            <circle key={i} cx={x(run[0].dist)} cy={y(run[0].hMsl as number)} r={2} fill="#ffd600" />
          ) : (
            <polyline key={i} fill="none" stroke="#ffd600" strokeWidth={2} strokeLinejoin="round"
              points={run.map((s) => `${x(s.dist).toFixed(1)},${y(s.hMsl as number).toFixed(1)}`).join(' ')} />
          ),
        )}
        {hover && (
          <g>
            <line x1={x(hover.dist)} x2={x(hover.dist)} y1={PAD.t} y2={H - PAD.b} stroke="white" strokeOpacity={0.4} />
            {hover.hMsl !== null && <circle cx={x(hover.dist)} cy={y(hover.hMsl)} r={4} fill="#ffd600" stroke="black" />}
          </g>
        )}
      </svg>

      <p className="text-[11px] text-white/80 font-mono tabular-nums leading-snug">
        {hover
          ? `${formatDistance(hover.dist)} along line · ${hover.hMsl !== null ? `${hover.hMsl.toFixed(2)} m above sea level` : 'no surface here'}`
          : `Min ${st.min.toFixed(2)} · max ${st.max.toFixed(2)} m above sea level` +
            (st.netChange !== null ? ` · net ${st.netChange >= 0 ? '+' : ''}${st.netChange.toFixed(2)} m` : '') +
            (st.gradePct !== null ? ` (${st.gradePct.toFixed(1)}%)` : '')}
      </p>
      <p className="text-[10px] text-white/50 leading-snug mt-0.5">
        Indicative only · EGM2008 heights, not the Israeli official model · every {profile.spacing.toFixed(2)} m
        {profile.gaps > 0 && ` · ${profile.gaps} gap${profile.gaps === 1 ? '' : 's'} where no surface was found (not interpolated)`}
      </p>
    </div>
  )
}
