import { useState } from 'react'
import { MapPin, X, Trash2, Download, FileText, ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GeoPoint } from '@/lib/geopoints'
import { exportCsv, exportKml } from '@/lib/geopoints'

interface Props {
  geopoints:      GeoPoint[]
  active:         boolean
  onToggleActive: () => void
  onDelete:       (id: string) => void
  onUpdateNote:   (id: string, note: string) => void
  onClear:        () => void
}

function fmt(n: number, d: number) { return n.toFixed(d) }

export function GeopointPanel({ geopoints, active, onToggleActive, onDelete, onUpdateNote, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  function startEdit(pt: GeoPoint) {
    setEditingId(pt.id)
    setEditDraft(pt.note)
  }

  function commitEdit(id: string) {
    onUpdateNote(id, editDraft.trim())
    setEditingId(null)
  }

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 h-8 px-3 rounded-xl text-xs font-medium select-none',
          'bg-[#080c18]/80 backdrop-blur-md border shadow-lg transition-all duration-200',
          active
            ? 'border-orange-400/60 text-orange-300 shadow-orange-400/10'
            : open
            ? 'border-[#86B735]/50 text-[#a3d44a] shadow-[#86B735]/10'
            : 'border-white/15 text-white/75 hover:text-white/95 hover:border-white/25',
        )}
      >
        <MapPin className="w-3.5 h-3.5" />
        <span>Points</span>
        {geopoints.length > 0 && (
          <span className={cn(
            'rounded-full px-1.5 text-[10px] font-semibold border',
            active
              ? 'bg-orange-400/20 text-orange-300 border-orange-400/30'
              : 'bg-[#86B735]/20 text-[#a3d44a] border-[#86B735]/25',
          )}>
            {geopoints.length}
          </span>
        )}
        {open ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute bottom-full mb-2 right-0 w-80 rounded-2xl border border-white/[0.15]
                        bg-[#0a0e1a]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 flex flex-col
                        overflow-hidden max-h-[28rem]">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.15] shrink-0 gap-2">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">
              Geo Points
            </span>
            <div className="flex items-center gap-1.5 ml-auto">
              {/* Collect toggle */}
              <button
                onClick={onToggleActive}
                className={cn(
                  'flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[10px] font-medium transition-all',
                  active
                    ? 'bg-orange-500/25 text-orange-300 border border-orange-500/50 shadow-[0_0_8px_rgba(251,146,60,0.3)]'
                    : 'bg-white/[0.08] text-white/60 border border-white/[0.15] hover:text-white/90 hover:border-white/30',
                )}
              >
                <MapPin className="w-2.5 h-2.5" />
                {active ? 'Collecting…' : 'Collect'}
              </button>

              {/* Export CSV */}
              {geopoints.length > 0 && (
                <>
                  <button
                    onClick={() => exportCsv(geopoints)}
                    title="Export CSV"
                    className="flex items-center gap-1 h-6 px-2 rounded-lg text-[10px] font-medium
                               bg-white/[0.06] text-white/55 border border-white/[0.12]
                               hover:bg-white/[0.12] hover:text-white/80 transition-all"
                  >
                    <FileText className="w-2.5 h-2.5" />CSV
                  </button>
                  <button
                    onClick={() => exportKml(geopoints)}
                    title="Export KML (can be uploaded as a layer)"
                    className="flex items-center gap-1 h-6 px-2 rounded-lg text-[10px] font-medium
                               bg-white/[0.06] text-white/55 border border-white/[0.12]
                               hover:bg-white/[0.12] hover:text-white/80 transition-all"
                  >
                    <Download className="w-2.5 h-2.5" />KML
                  </button>
                  <button
                    onClick={onClear}
                    title="Clear all points"
                    className="flex items-center justify-center h-6 w-6 rounded-lg
                               text-white/30 hover:text-red-400 hover:bg-red-500/10
                               border border-white/[0.10] transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Instruction when active */}
          {active && (
            <div className="px-4 py-2 text-[11px] text-orange-300/80 bg-orange-500/[0.07] border-b border-orange-500/[0.12] shrink-0">
              Click anywhere on the globe or model to collect a point.
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {geopoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 h-16">
                <MapPin className="w-4 h-4 text-white/25" />
                <span className="text-[11px] text-white/50">
                  {active ? 'Click on the globe to add points' : 'Enable Collect and click on the globe'}
                </span>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {geopoints.map((pt, i) => (
                  <div key={pt.id}
                    className="flex items-start gap-2 px-3 py-2.5 group hover:bg-white/[0.04] transition-colors">
                    {/* Index badge */}
                    <span className="shrink-0 mt-0.5 h-4 w-4 rounded-full bg-orange-500/25 text-orange-300
                                     text-[9px] font-bold flex items-center justify-center border border-orange-500/30">
                      {i + 1}
                    </span>
                    {/* Coords + note */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-white/85">{pt.label}</p>
                      <p className="text-[10px] font-mono text-white/45 leading-relaxed">
                        {fmt(pt.lat, 6)}°N&nbsp;&nbsp;{fmt(pt.lon, 6)}°E
                      </p>
                      <p className="text-[10px] font-mono text-white/35 mb-1">
                        Alt: {fmt(pt.alt, 1)} m
                      </p>

                      {/* Note field */}
                      {editingId === pt.id ? (
                        <input
                          autoFocus
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onBlur={() => commitEdit(pt.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit(pt.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          placeholder="Add a note…"
                          className="w-full text-[11px] rounded-md border border-orange-400/30 bg-white/[0.06]
                                     px-2 py-0.5 text-white/80 placeholder:text-white/25
                                     focus:outline-none focus:border-orange-400/60 transition-colors"
                        />
                      ) : (
                        <button
                          onClick={() => startEdit(pt)}
                          className={cn(
                            'flex items-center gap-1 text-[10px] transition-colors',
                            pt.note
                              ? 'text-white/55 hover:text-white/80'
                              : 'text-white/20 hover:text-white/45 opacity-0 group-hover:opacity-100',
                          )}
                        >
                          <Pencil className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate max-w-[160px]">{pt.note || 'Add note…'}</span>
                        </button>
                      )}
                    </div>
                    {/* Delete */}
                    <button
                      onClick={() => onDelete(pt.id)}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg mt-0.5
                                 text-white/20 hover:text-red-400 hover:bg-red-500/10
                                 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer: KML tip */}
          {geopoints.length > 0 && (
            <div className="px-4 py-2.5 border-t border-white/[0.08] text-[10px] text-white/30 shrink-0">
              Tip: export as KML and upload via the Layers panel to persist points across sessions.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
