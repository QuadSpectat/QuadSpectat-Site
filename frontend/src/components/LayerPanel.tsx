import { useState, useRef, useEffect } from 'react'
import { Layers, Eye, EyeOff, Upload, X, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { listLayers, deleteLayer, getLayerDownloadUrl } from '@/lib/api'
import type { Layer } from '@/lib/api'
import { WheelSlider } from '@/components/WheelSlider'

interface Props {
  modelId: string
  onLayersChange: (layers: ResolvedLayer[]) => void
}

export interface ResolvedLayer {
  id: string
  name: string
  url: string
  visible: boolean
  heightOffset: number
}

const ACCEPTED = '.kml,.kmz,.geojson,.json,.czml'

export function LayerPanel({ modelId, onLayersChange }: Props) {
  const [open, setOpen] = useState(false)
  const [layers, setLayers] = useState<Layer[]>([])
  const [resolved, setResolved] = useState<ResolvedLayer[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLayers([])
    setResolved([])
    setExpandedIds(new Set())
    listLayers(modelId)
      .then((ls) => { setLayers(ls); void resolveAll(ls) })
      .catch(console.error)
  }, [modelId])

  useEffect(() => { onLayersChange(resolved) }, [resolved])

  async function resolveAll(ls: Layer[]) {
    const urls = await Promise.all(ls.map((l) => getLayerDownloadUrl(l.id)))
    const res: ResolvedLayer[] = ls.map((l, i) => ({
      id: l.id, name: l.name, url: urls[i], visible: l.visible !== 0, heightOffset: 0,
    }))
    setResolved(res)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    setUploadError(null)
    try {
      const params = new URLSearchParams({ filename: file.name, model_id: modelId })
      const res = await fetch(`/api/layers/upload?${params.toString()}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`${res.status} ${text}`)
      }
      const layer = await res.json() as Layer
      const newLayers = [...layers, layer]
      setLayers(newLayers)
      void resolveAll(newLayers)
    } catch (err) {
      console.error(err)
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: string) {
    await deleteLayer(id)
    setLayers((ls) => ls.filter((l) => l.id !== id))
    const newResolved = resolved.filter((r) => r.id !== id)
    setResolved(newResolved)
    onLayersChange(newResolved)
  }

  function toggleVisible(id: string) {
    const nr = resolved.map((r) => r.id === id ? { ...r, visible: !r.visible } : r)
    setResolved(nr)
    onLayersChange(nr)
  }

  function updateHeightOffset(id: string, offset: number) {
    const nr = resolved.map((r) => r.id === id ? { ...r, heightOffset: offset } : r)
    setResolved(nr)
    onLayersChange(nr)
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 h-8 px-3 rounded-xl text-xs font-medium select-none',
          'bg-[#080c18]/80 backdrop-blur-md border shadow-lg transition-all duration-200',
          open
            ? 'border-[#86B735]/50 text-[#a3d44a] shadow-[#86B735]/10'
            : 'border-white/15 text-white/75 hover:text-white/95 hover:border-white/25',
        )}
      >
        <Layers className="w-3.5 h-3.5" />
        <span>Layers</span>
        {layers.length > 0 && (
          <span className="bg-[#86B735]/20 text-[#a3d44a] border border-[#86B735]/25 rounded-full px-1.5 text-[10px] font-semibold">
            {layers.length}
          </span>
        )}
        {open ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute bottom-full mb-2 right-0 w-72 rounded-2xl border border-white/[0.15]
                        bg-[#0a0e1a]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 flex flex-col
                        overflow-hidden max-h-96">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.15] shrink-0">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">
              Overlay Layers
            </span>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[10px] font-medium
                         bg-[#86B735]/20 text-[#a3d44a] border border-[#86B735]/40
                         hover:bg-[#86B735]/30 hover:text-[#c5f06a] disabled:opacity-40 transition-all"
            >
              <Upload className="w-2.5 h-2.5" />
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => void handleFileChange(e)}
            />
          </div>

          {uploadError && (
            <div className="px-4 py-2 text-[11px] text-red-400/80 border-b border-white/[0.06] bg-red-500/[0.07]">
              {uploadError}
            </div>
          )}

          {/* Layer list */}
          <div className="flex-1 overflow-y-auto">
            {layers.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 h-16">
                <Layers className="w-4 h-4 text-white/30" />
                <span className="text-[11px] text-white/55">Upload a KML / KMZ / GeoJSON file</span>
              </div>
            )}
            {layers.map((layer) => {
              const res = resolved.find((r) => r.id === layer.id)
              const visible = res?.visible ?? true
              const heightOffset = res?.heightOffset ?? 0
              const isExpanded = expandedIds.has(layer.id)
              return (
                <div key={layer.id} className="border-b border-white/[0.04]">
                  {/* Main row */}
                  <div className="flex items-center gap-2 px-3 py-2.5 group/row hover:bg-white/[0.06] transition-colors">
                    {/* Eye */}
                    <button
                      onClick={() => toggleVisible(layer.id)}
                      title={visible ? 'Hide layer' : 'Show layer'}
                      className={cn(
                        'shrink-0 w-6 h-6 flex items-center justify-center rounded-lg transition-all duration-150',
                        visible
                          ? 'text-[#86B735]/70 hover:text-[#a3d44a] hover:bg-[#86B735]/10'
                          : 'text-white/18 hover:text-white/45 hover:bg-white/[0.05]',
                      )}
                    >
                      {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>

                    {/* Name */}
                    <span className={cn(
                      'flex-1 text-[12px] truncate transition-colors min-w-0',
                      visible ? 'text-white/90' : 'text-white/35 line-through',
                    )}>
                      {layer.name}
                    </span>

                    {/* Height offset badge (when non-zero) */}
                    {heightOffset !== 0 && (
                      <span className="shrink-0 text-[10px] font-mono text-[#86B735]/70">
                        {heightOffset > 0 ? '+' : ''}{heightOffset}m
                      </span>
                    )}

                    {/* Expand toggle */}
                    <button
                      onClick={() => toggleExpand(layer.id)}
                      title="Layer settings"
                      className={cn(
                        'shrink-0 w-6 h-6 flex items-center justify-center rounded-lg transition-all duration-150',
                        isExpanded
                          ? 'text-[#86B735]/70 bg-[#86B735]/10'
                          : 'text-white/25 hover:text-white/55 hover:bg-white/[0.05] opacity-0 group-hover/row:opacity-100',
                      )}
                    >
                      <ChevronsUpDown className="w-3 h-3" />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => void handleDelete(layer.id)}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg
                                 text-white/25 hover:text-red-400 hover:bg-red-500/10
                                 transition-all duration-150 opacity-0 group-hover/row:opacity-100"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Expanded: height offset slider */}
                  {isExpanded && (
                    <div className="px-4 pb-3 flex flex-col gap-1.5 bg-white/[0.015]">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">
                          Height Offset
                        </span>
                        <span className="text-[11px] font-mono text-[#a3d44a]">
                          {heightOffset >= 0 ? '+' : ''}{heightOffset} m
                        </span>
                      </div>
                      <div className="relative h-4 flex items-center group/sl">
                        <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.18]" />
                        {/* fill bar: centre-out for bipolar range */}
                        <div
                          className="absolute h-[3px] rounded-full bg-[#86B735]/85"
                          style={{
                            left:  heightOffset >= 0 ? '50%' : `${((heightOffset + 200) / 400) * 100}%`,
                            width: `${(Math.abs(heightOffset) / 400) * 50}%`,
                          }}
                        />
                        <div
                          className="absolute w-[13px] h-[13px] rounded-full bg-white shadow-md ring-[1.5px] ring-black/40 pointer-events-none group-hover/sl:scale-[1.2] transition-transform duration-100"
                          style={{ left: `calc(${((heightOffset + 200) / 400) * 100}% - 6.5px)` }}
                        />
                        <WheelSlider
                          min={-200} max={200} step={1}
                          value={heightOffset}
                          onChange={(v) => updateHeightOffset(layer.id, v)}
                          className="absolute inset-x-0 opacity-0 h-4 w-full cursor-pointer"
                        />
                      </div>
                      {heightOffset !== 0 && (
                        <button
                          onClick={() => updateHeightOffset(layer.id, 0)}
                          className="self-end text-[10px] text-white/25 hover:text-white/55 transition-colors"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
