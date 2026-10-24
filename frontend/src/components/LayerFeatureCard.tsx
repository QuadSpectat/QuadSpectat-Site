import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { wgs84ToItm } from '@/lib/itm'
import type { FeatureInfo } from '@/lib/layerRender'

export interface FeaturePick {
  layerName: string
  info: FeatureInfo
  /** where the feature was clicked (WGS84 degrees); for a point feature `info.anchor` wins */
  click: { lon: number; lat: number } | null
}

type Crs = 'wgs84' | 'itm'
const fmt = (n: number, d: number) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false })

const readCrs = (): Crs => { try { return localStorage.getItem('qs-layer-coord-crs') === 'itm' ? 'itm' : 'wgs84' } catch { return 'wgs84' } }

/** Small read-only card for a clicked layer feature: name, attributes, and its coordinates in WGS84 or ITM. */
export function LayerFeatureCard({ pick, onClose }: { pick: FeaturePick; onClose: () => void }) {
  const [crs, setCrs] = useState<Crs>(readCrs)
  const choose = (c: Crs) => { setCrs(c); try { localStorage.setItem('qs-layer-coord-crs', c) } catch { /* private mode */ } }
  const at = pick.info.anchor ?? pick.click
  const label = pick.info.kind === 'point' ? 'Point' : 'Clicked at'

  return (
    <div role="dialog" aria-label={`Layer feature: ${pick.info.title}`} data-testid="layer-feature-card"
      className="absolute left-[max(0.75rem,env(safe-area-inset-left))] bottom-[calc(8.75rem+env(safe-area-inset-bottom)+var(--qs-dock-h,0px))] z-30
                 w-64 max-w-[calc(100%-1.5rem)] rounded-2xl border border-white/[0.15] bg-[#0b100d]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 text-white">
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-white/50 truncate" title={pick.layerName}>{pick.layerName}</p>
          <p className="text-[13px] font-semibold truncate" dir="auto" title={pick.info.title}>{pick.info.title}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="shrink-0 -mt-1 -mr-1 w-8 h-8 coarse:w-11 coarse:h-11 grid place-items-center rounded-lg text-white/60 hover:text-white hover:bg-white/10">
          <X className="w-4 h-4" />
        </button>
      </div>

      {pick.info.rows.length > 0 && (
        <dl className="px-3 pt-1 max-h-32 overflow-y-auto text-[11px] grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          {pick.info.rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-white/50 truncate max-w-[6rem]" title={k}>{k}</dt>
              <dd className="text-white/90 break-words min-w-0" dir="auto">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="px-3 py-2 mt-1 border-t border-white/[0.10]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-white/50">{label}</span>
          <div className="flex rounded overflow-hidden border border-white/[0.12]">
            {(['wgs84', 'itm'] as Crs[]).map((c) => (
              <button key={c} onClick={() => choose(c)} aria-pressed={crs === c}
                className={cn('h-5 coarse:h-9 px-1.5 coarse:px-3 text-[9px] coarse:text-[11px] font-semibold transition-colors',
                  crs === c ? 'bg-orange-500/30 text-orange-300' : 'text-white/45 hover:text-white/70')}>
                {c.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {!at ? (
          <p className="text-[10px] font-mono text-white/40 mt-1">No position</p>
        ) : crs === 'itm' ? (
          (() => {
            const { easting, northing } = wgs84ToItm(at.lat, at.lon)
            return <p data-testid="coord-itm" className="text-[11px] font-mono text-white/85 mt-1" title="Israeli TM Grid (EPSG:2039)">E&nbsp;{fmt(easting, 2)}&nbsp;&nbsp;N&nbsp;{fmt(northing, 2)}</p>
          })()
        ) : (
          <p data-testid="coord-wgs84" className="text-[11px] font-mono text-white/85 mt-1" title="WGS84">{fmt(at.lat, 6)}°&nbsp;{fmt(at.lon, 6)}°</p>
        )}
      </div>
    </div>
  )
}
