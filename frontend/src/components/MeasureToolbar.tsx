import { useRef, useEffect, useState } from 'react'
import { Ruler, Hexagon, Box, Trash2, Home, MapPin, X, FileText, Download, Pencil, Undo2, Check, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MeasureMode } from '@/lib/measure'
import type { GeoPoint, ExportCrs } from '@/lib/geopoints'
import { exportCsv, exportKml, wgs84ToItm } from '@/lib/geopoints'
import { useCoarsePointer } from '@/hooks/useCoarsePointer'

interface Props {
  mode: MeasureMode
  onModeChange: (mode: MeasureMode) => void
  baseElevation: number
  onBaseElevationChange: (v: number) => void
  result: string | null
  onResetCamera?: () => void
  // Geopoint collection
  geopointActive: boolean
  onGeopointToggle: () => void
  geopoints: GeoPoint[]
  onGeopointDelete: (id: string) => void
  onGeopointNote: (id: string, note: string) => void
  onGeopointClear: () => void
  /** Where the tool row floats: top-right (default), top-center (console) or bottom-dock (client showcase). */
  placement?: 'top-right' | 'top-center' | 'bottom-dock'
  /** 'tools' = only the tool row, 'panels' = only results + points (for a side inspector), 'all' = everything (default). */
  part?: 'all' | 'tools' | 'panels'
  /** Earlier measurement results, newest first (shown in the inspector). */
  history?: { id: string; text: string }[]
  /** Removes the last measurement point (for devices without a right mouse button). */
  onUndo?: () => void
  /** Completes the current measurement (touch devices have no double-click). */
  onFinish?: () => void
}

const TOOLS: { key: Exclude<MeasureMode, 'none'>; label: string; Icon: typeof Ruler }[] = [
  { key: 'distance', label: 'Distance', Icon: Ruler },
  { key: 'area',     label: 'Area',     Icon: Hexagon },
  { key: 'volume',   label: 'Volume',   Icon: Box },
  { key: 'profile',  label: 'Profile',  Icon: TrendingUp },
]

const INSTRUCTIONS: Record<Exclude<MeasureMode, 'none'>, string> = {
  distance: 'Click to add points · Double-click to finish · Right-click to undo',
  area:     'Click to add vertices · Double-click to close · Right-click to undo',
  volume:   'Set base elevation · Click vertices · Double-click to close',
  profile:  'Click the start and end of the line · Right-click to undo · Indicative only',
}

/** Touch wording: a finger taps; there is no right-click or double-click. */
const TOUCH_INSTRUCTIONS: Record<Exclude<MeasureMode, 'none'>, string> = {
  distance: 'Tap to add points. Tap Finish when done. Undo removes the last point.',
  area:     'Tap to add corners. Tap Finish to close the area. Undo removes the last point.',
  volume:   'Set the base height, then tap the corners. Tap Finish to close. Undo removes the last point.',
  profile:  'Tap the start of the line, then tap the end. The profile appears by itself. Undo removes the last point.',
}

const PANEL = 'rounded-2xl border border-white/[0.15] bg-[#0b100d]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80'

function fmt(n: number, d: number) { return n.toFixed(d) }

export function MeasureToolbar({
  mode, onModeChange, baseElevation, onBaseElevationChange, result, onResetCamera,
  geopointActive, onGeopointToggle, geopoints, onGeopointDelete, onGeopointNote, onGeopointClear,
  placement = 'top-right', part = 'all', history, onUndo, onFinish,
}: Props) {
  const coarse = useCoarsePointer()
  const showTools  = part !== 'panels'
  const showPanels = part !== 'tools'
  const rootClass =
    part === 'panels'
      ? 'flex flex-col gap-3 w-full'
      : placement === 'top-center'
        ? 'absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-10 flex flex-col gap-2 items-center pointer-events-none'
        : placement === 'bottom-dock'
          ? 'absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom)+var(--qs-dock-h,0px))] left-1/2 -translate-x-1/2 z-10 flex flex-col-reverse gap-2 items-center pointer-events-none max-w-[calc(100%-1.5rem)]'
          : 'absolute top-[calc(3.5rem+env(safe-area-inset-top))] sm:top-3 right-[max(0.75rem,env(safe-area-inset-right))] z-10 flex flex-col gap-2 items-end pointer-events-none max-w-[calc(100%-1.5rem)]'
  const elevInputRef    = useRef<HTMLInputElement>(null)
  const elevRef         = useRef(baseElevation)
  elevRef.current       = baseElevation
  const elevChangeRef   = useRef(onBaseElevationChange)
  elevChangeRef.current = onBaseElevationChange

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [exportCrs, setExportCrs] = useState<ExportCrs>('wgs84')

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

  const showUndo = showTools && ((mode !== 'none' && !result) || geopointActive) &&
    (geopointActive ? geopoints.length > 0 : !!onUndo)

  function handleUndo() {
    if (geopointActive) {
      const last = geopoints[geopoints.length - 1]
      if (last) onGeopointDelete(last.id)
    } else {
      onUndo?.()
    }
  }

  function handleClearMeasurement() {
    if (result && !window.confirm('Delete this measurement?')) return
    onModeChange('none')
  }

  function handleDeletePoint(id: string, label: string) {
    if (window.confirm(`Delete point ${label}?`)) onGeopointDelete(id)
  }

  function handleClearAll() {
    if (window.confirm(`Delete all ${geopoints.length} points?`)) onGeopointClear()
  }

  function commitNote(id: string) {
    onGeopointNote(id, editDraft.trim())
    setEditingId(null)
  }

  return (
    <div className={rootClass}>
      {/* Tool buttons */}
      {showTools && (
      <div className={cn(PANEL, 'flex items-center gap-0.5 p-1 pointer-events-auto')}>
        {TOOLS.map(({ key, label, Icon }) => (
          <button
            key={key}
            title={label}
            onClick={() => handleToolClick(key)}
            className={cn(
              'flex items-center justify-center gap-1.5 h-8 coarse:h-11 coarse:min-w-11 px-2.5 rounded-xl text-xs font-medium transition-all duration-150 select-none',
              mode === key
                ? 'bg-[#9ACD3C]/25 text-[#b8e05c] border border-[#9ACD3C]/70 shadow-[0_0_10px_rgba(154,205,60,0.35)]'
                : 'text-white/75 hover:text-white/95 hover:bg-white/[0.08] border border-transparent',
            )}
          >
            <Icon size={13} strokeWidth={1.8} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}

        <div className="w-px h-4 bg-white/[0.20] mx-1" />

        {/* Geopoint pin tool */}
        <button
          title={geopointActive ? 'Stop collecting points' : 'Collect geo-points'}
          onClick={onGeopointToggle}
          className={cn(
            'flex items-center justify-center gap-1.5 h-8 coarse:h-11 coarse:min-w-11 px-2.5 rounded-xl text-xs font-medium transition-all duration-150 select-none',
            geopointActive
              ? 'bg-orange-500/25 text-orange-300 border border-orange-500/60 shadow-[0_0_10px_rgba(251,146,60,0.3)]'
              : 'text-white/75 hover:text-white/95 hover:bg-white/[0.08] border border-transparent',
          )}
        >
          <MapPin size={13} strokeWidth={1.8} />
          <span className="hidden sm:inline">
            {geopointActive ? 'Stop' : 'Points'}
            {geopoints.length > 0 && !geopointActive && (
              <span className="ml-1 text-orange-300/80">({geopoints.length})</span>
            )}
          </span>
        </button>

        {showUndo && !coarse && (
          <>
            <div className="w-px h-4 bg-white/[0.20] mx-1" />
            <button
              title="Undo last point"
              aria-label="Undo last point"
              onClick={handleUndo}
              className="flex items-center justify-center h-11 w-11 rounded-xl text-white/75
                         hover:text-white/95 hover:bg-white/[0.08] border border-transparent
                         transition-all duration-150 select-none"
            >
              <Undo2 size={16} strokeWidth={1.8} />
            </button>
          </>
        )}

        <div className="w-px h-4 bg-white/[0.20] mx-1" />

        <button
          title="Clear measurement"
          onClick={handleClearMeasurement}
          disabled={mode === 'none' && !result}
          className="flex items-center justify-center h-8 w-8 coarse:h-11 coarse:w-11 rounded-xl text-white/60
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
              className="flex items-center justify-center h-8 w-8 coarse:h-11 coarse:w-11 rounded-xl text-white/60
                         hover:text-[#b8e05c] hover:bg-[#9ACD3C]/10 border border-transparent
                         transition-all duration-150 pointer-events-auto"
            >
              <Home size={13} strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>
      )}

      {/* Volume base elevation */}
      {showTools && mode === 'volume' && (
        <div className={cn(PANEL, 'flex items-center gap-2.5 px-3 py-2 pointer-events-auto')}>
          <label className="text-[11px] text-white/70 whitespace-nowrap tracking-wide">Base height (above sea level)</label>
          <input
            type="number" step="1" value={baseElevation}
            onChange={(e) => onBaseElevationChange(parseFloat(e.target.value) || 0)}
            ref={elevInputRef}
            className="w-20 h-6 rounded-lg border border-white/[0.20] bg-white/[0.08] px-2
                       text-xs text-white/90 text-right focus:outline-none focus:border-[#9ACD3C]/60
                       focus:bg-[#9ACD3C]/[0.08] transition-colors"
          />
          <span className="text-[11px] text-white/60">m</span>
          <span className="text-[10px] text-white/45 leading-tight max-w-[9rem]">Flat plane the volume is measured against</span>
        </div>
      )}

      {/* Measure instruction */}
      {showTools && mode !== 'none' && !result && (
        <div className={cn(PANEL, 'px-3 py-2 max-w-xs', coarse && 'pointer-events-auto')}>
          <p className="text-[11px] text-white/70 leading-snug">{coarse ? TOUCH_INSTRUCTIONS[mode] : INSTRUCTIONS[mode]}</p>
          {coarse && (
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={handleUndo} aria-label="Undo last point"
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl text-xs font-semibold
                           text-white/85 bg-white/[0.08] border border-white/[0.15] active:bg-white/[0.16] select-none">
                <Undo2 size={16} strokeWidth={1.8} />Undo
              </button>
              {mode !== 'profile' && <button type="button" onClick={() => onFinish?.()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl text-xs font-bold
                           bg-[#9ACD3C] text-[#17220a] active:brightness-90 select-none">
                <Check size={16} strokeWidth={2.4} />Finish
              </button>}
            </div>
          )}
        </div>
      )}

      {/* Measure result */}
      {showPanels && result && (
        <div className={cn(PANEL, 'px-4 py-2.5 pointer-events-auto', part === 'panels' && 'border-[#9ACD3C]/60')}>
          <p className={cn('font-semibold text-white/95 tabular-nums font-mono', part === 'panels' ? 'text-xl' : 'text-sm')}>{result}</p>
          <p className="text-[11px] text-white/60 mt-0.5">Indicative · {coarse ? 'tap' : 'click'} a tool to measure again</p>
        </div>
      )}
      {showPanels && part === 'panels' && !result && !(history && history.length) && geopoints.length === 0 && (
        <div className={cn(PANEL, 'px-4 py-3')}>
          <p className="text-[11px] text-white/60 leading-snug">Measurements and points you take on the model are listed here.</p>
        </div>
      )}
      {showPanels && history && history.length > 0 && (
        <div className={cn(PANEL, 'w-full overflow-hidden')}>
          <div className="px-3 py-2 border-b border-white/[0.10]">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-white/50">Earlier · {history.length}</span>
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {history.map((h) => (
              <li key={h.id} className="px-3 py-2 text-xs font-mono tabular-nums text-white/80 border-b border-white/[0.04] last:border-0">{h.text}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Geopoint collect instruction */}
      {showTools && geopointActive && (
        <div className={cn(PANEL, 'px-3 py-2 max-w-xs border-orange-500/30 pointer-events-auto')}>
          <p className="text-[11px] text-orange-300/90 leading-snug">
            {coarse ? 'Tap' : 'Click'} anywhere on the globe or model to pin a point.
            {coarse ? ' Tap ' : ' Click '}<strong>Stop</strong> when done.
          </p>
          {coarse && geopoints.length > 0 && (
            <button type="button" onClick={handleUndo} aria-label="Undo last point"
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-xl text-xs font-semibold
                         text-white/85 bg-white/[0.08] border border-white/[0.15] active:bg-white/[0.16] select-none">
              <Undo2 size={16} strokeWidth={1.8} />Undo last point
            </button>
          )}
        </div>
      )}

      {/* Geopoint list panel */}
      {showPanels && geopoints.length > 0 && !geopointActive && (
        <div className={cn(PANEL, part === 'panels' ? 'w-full' : 'w-72', 'flex flex-col overflow-hidden pointer-events-auto')}>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 px-3 py-2 border-b border-white/[0.10]">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-white/50">
              Points · {geopoints.length}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {/* CRS toggle */}
              <div className="flex rounded overflow-hidden border border-white/[0.12]">
                {(['wgs84', 'itm'] as ExportCrs[]).map((c) => (
                  <button key={c} onClick={() => setExportCrs(c)}
                    className={cn(
                      'h-5 px-1.5 text-[9px] font-semibold transition-colors',
                      exportCrs === c
                        ? 'bg-orange-500/30 text-orange-300'
                        : 'text-white/35 hover:text-white/60 bg-transparent',
                    )}>
                    {c.toUpperCase()}
                  </button>
                ))}
              </div>
              <button onClick={() => { void exportCsv(geopoints, exportCrs) }}
                title={`Export CSV (${exportCrs.toUpperCase()}) — ZIP with thumbnails if any point has one`}
                className="flex items-center gap-1 h-5 px-1.5 rounded text-[9px] font-medium
                           text-white/40 hover:text-white/70 border border-white/[0.10] hover:border-white/20 transition-all">
                <FileText size={9} />CSV
              </button>
              <button onClick={() => exportKml(geopoints)} title="Export KML"
                className="flex items-center gap-1 h-5 px-1.5 rounded text-[9px] font-medium
                           text-white/40 hover:text-white/70 border border-white/[0.10] hover:border-white/20 transition-all">
                <Download size={9} />KML
              </button>
              <button onClick={handleClearAll} title="Clear all points"
                className="flex items-center justify-center h-5 w-5 rounded
                           text-white/25 hover:text-red-400 border border-white/[0.08] transition-all">
                <Trash2 size={9} />
              </button>
            </div>
          </div>

          {/* Points list */}
          <div className="max-h-56 overflow-y-auto">
            {geopoints.map((pt, i) => (
              <div key={pt.id}
                className="flex items-start gap-2 px-3 py-2 group hover:bg-white/[0.04] border-b border-white/[0.04] transition-colors">
                <span className="shrink-0 mt-0.5 h-4 w-4 rounded-full bg-orange-500/25 text-orange-300
                                 text-[9px] font-bold flex items-center justify-center border border-orange-500/30">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-white/80">{pt.label}</p>
                  {exportCrs === 'itm' ? (() => {
                    const { easting, northing } = wgs84ToItm(pt.lat, pt.lon)
                    return (
                      <p className="text-[10px] font-mono text-white/40" title="Israel Transverse Mercator (EPSG:2039)">
                        E&nbsp;{fmt(easting, 2)}&nbsp;&nbsp;N&nbsp;{fmt(northing, 2)}
                      </p>
                    )
                  })() : (
                    <p className="text-[10px] font-mono text-white/40" title="WGS84">
                      {fmt(pt.lat, 5)}°&nbsp;{fmt(pt.lon, 5)}°
                    </p>
                  )}
                  {pt.altMsl != null ? (
                    <>
                      <p className="text-[10px] font-mono text-white/60" title="Orthometric height from the EGM2008 geoid, indicative">H&nbsp;{fmt(pt.altMsl, 2)}&nbsp;m&nbsp;above&nbsp;sea&nbsp;level&nbsp;(approx.)</p>
                      <p className="text-[10px] font-mono text-white/30 mb-1">ellipsoid {fmt(pt.alt, 1)} m</p>
                    </>
                  ) : (
                    <p className="text-[10px] font-mono text-white/30 mb-1">Alt {fmt(pt.alt, 1)} m (ellipsoid)</p>
                  )}

                  {editingId === pt.id ? (
                    <input autoFocus value={editDraft}
                      dir="auto"
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={() => commitNote(pt.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitNote(pt.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      placeholder="Add a note…"
                      className="w-full text-[10px] rounded border border-orange-400/30 bg-white/[0.06]
                                 px-1.5 py-0.5 text-white/80 placeholder:text-white/20
                                 focus:outline-none focus:border-orange-400/60 transition-colors"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingId(pt.id); setEditDraft(pt.note) }}
                      className={cn(
                        'flex items-center gap-1 text-[10px] transition-colors',
                        pt.note ? 'text-white/50 hover:text-white/75' : 'text-white/20 hover:text-white/40 opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <Pencil size={9} className="shrink-0" />
                      <span dir="auto" className="truncate max-w-[150px]">{pt.note || 'Add note…'}</span>
                    </button>
                  )}
                </div>
                <button onClick={() => handleDeletePoint(pt.id, pt.label)}
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded
                             text-white/20 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
