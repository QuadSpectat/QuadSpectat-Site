import { useState, useEffect, useRef, useCallback } from 'react'
import { Map, Eye, EyeOff, Upload, X, ChevronUp, ChevronDown, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { listOrthophotos, deleteOrthophoto } from '@/lib/api'
import type { Orthophoto } from '@/lib/api'
import { WheelSlider } from '@/components/WheelSlider'

export interface ResolvedOrthophoto {
  id: string
  name: string
  status: string
  error_message: string | null
  visible: boolean
  opacity: number
  bounds_west:  number | null
  bounds_south: number | null
  bounds_east:  number | null
  bounds_north: number | null
  zoom_min: number
  zoom_max: number
}

interface OrthoState extends ResolvedOrthophoto {}

interface Props {
  onOrthophotosChange: (photos: ResolvedOrthophoto[]) => void
}

const ACCEPTED = '.tif,.tiff,.ecw,.jp2,.j2k,.sid'

function toState(o: Orthophoto): OrthoState {
  return {
    id:           o.id,
    name:         o.name,
    status:       o.status,
    error_message: o.error_message,
    visible:      o.visible !== 0,
    opacity:      o.opacity ?? 1.0,
    bounds_west:  o.bounds_west,
    bounds_south: o.bounds_south,
    bounds_east:  o.bounds_east,
    bounds_north: o.bounds_north,
    zoom_min:     o.zoom_min ?? 0,
    zoom_max:     o.zoom_max ?? 22,
  }
}

const PANEL = 'rounded-2xl border border-white/[0.15] bg-[#0a0e1a]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80'

export function OrthophotoPanel({ onOrthophotosChange }: Props) {
  const [open, setOpen]           = useState(false)
  const [photos, setPhotos]       = useState<OrthoState[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Load on mount
  useEffect(() => {
    listOrthophotos()
      .then((list) => setPhotos(list.map(toState)))
      .catch(console.error)
  }, [])

  // Notify parent whenever state changes
  useEffect(() => { onOrthophotosChange(photos) }, [photos])

  // Poll while any orthophoto is still processing
  useEffect(() => {
    const needsPoll = photos.some((p) => p.status === 'pending' || p.status === 'processing')
    if (!needsPoll) return
    const timer = setInterval(async () => {
      const fresh = await listOrthophotos().catch(() => null)
      if (!fresh) return
      setPhotos((prev) => prev.map((p) => {
        const updated = fresh.find((f) => f.id === p.id)
        if (!updated) return p
        // Merge API-sourced fields but keep local visible/opacity
        return {
          ...p,
          status:       updated.status,
          error_message: updated.error_message,
          bounds_west:  updated.bounds_west,
          bounds_south: updated.bounds_south,
          bounds_east:  updated.bounds_east,
          bounds_north: updated.bounds_north,
          zoom_min:     updated.zoom_min ?? p.zoom_min,
          zoom_max:     updated.zoom_max ?? p.zoom_max,
        }
      }))
    }, 3000)
    return () => clearInterval(timer)
  }, [photos.map((p) => p.status).join(',')])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    setUploadError(null)
    try {
      const params = new URLSearchParams({ filename: file.name })
      const res = await fetch(`/api/orthophotos/upload?${params.toString()}`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type || 'image/tiff' },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`${res.status} ${text}`)
      }
      const photo = await res.json() as Orthophoto
      setPhotos((prev) => [...prev, toState(photo)])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [])

  async function handleDelete(id: string) {
    await deleteOrthophoto(id)
    setPhotos((prev) => {
      const next = prev.filter((p) => p.id !== id)
      onOrthophotosChange(next)
      return next
    })
  }

  function toggleVisible(id: string) {
    setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, visible: !p.visible } : p))
  }

  function setOpacity(id: string, opacity: number) {
    setPhotos((prev) => prev.map((p) => p.id === id ? { ...p, opacity } : p))
  }

  const readyCount = photos.filter((p) => p.status === 'ready').length

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
        <Map className="w-3.5 h-3.5" />
        <span>Ortho</span>
        {readyCount > 0 && (
          <span className="bg-[#86B735]/20 text-[#a3d44a] border border-[#86B735]/25 rounded-full px-1.5 text-[10px] font-semibold">
            {readyCount}
          </span>
        )}
        {open ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
      </button>

      {/* Panel */}
      {open && (
        <div className={cn(
          PANEL,
          'absolute bottom-full mb-2 right-0 w-72 flex flex-col overflow-hidden max-h-[28rem]',
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.15] shrink-0">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">
              Orthophotos
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

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {photos.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 h-16">
                <Map className="w-4 h-4 text-white/30" />
                <span className="text-[11px] text-white/55">Upload a GeoTIFF / ECW / JP2 file</span>
              </div>
            )}

            {photos.map((photo) => (
              <div key={photo.id} className="border-b border-white/[0.04]">
                {/* Main row */}
                <div className="flex items-center gap-2 px-3 py-2.5 group/row hover:bg-white/[0.06] transition-colors">
                  {/* Status / visibility toggle */}
                  {photo.status === 'ready' ? (
                    <button
                      onClick={() => toggleVisible(photo.id)}
                      title={photo.visible ? 'Hide' : 'Show'}
                      className={cn(
                        'shrink-0 w-6 h-6 flex items-center justify-center rounded-lg transition-all duration-150',
                        photo.visible
                          ? 'text-[#86B735]/70 hover:text-[#a3d44a] hover:bg-[#86B735]/10'
                          : 'text-white/18 hover:text-white/45 hover:bg-white/[0.05]',
                      )}
                    >
                      {photo.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  ) : photo.status === 'error' ? (
                    <span className="shrink-0 w-6 h-6 flex items-center justify-center">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400/80" />
                    </span>
                  ) : (
                    <span className="shrink-0 w-6 h-6 flex items-center justify-center">
                      <Loader2 className="w-3.5 h-3.5 text-white/40 animate-spin" />
                    </span>
                  )}

                  {/* Name + status */}
                  <div className="flex-1 min-w-0">
                    <span className={cn(
                      'block text-[12px] truncate transition-colors',
                      photo.status === 'ready' && photo.visible ? 'text-white/90' :
                      photo.status === 'error' ? 'text-red-400/70' :
                      photo.status === 'ready' ? 'text-white/35 line-through' :
                      'text-white/55',
                    )}>
                      {photo.name}
                    </span>
                    {photo.status !== 'ready' && (
                      <span className="block text-[10px] mt-0.5 truncate" style={{
                        color: photo.status === 'error' ? 'rgb(248 113 113 / 0.6)' : 'rgb(255 255 255 / 0.35)',
                      }}>
                        {photo.status === 'error'
                          ? (photo.error_message ?? 'Processing failed')
                          : photo.status === 'processing' ? 'Processing with GDAL…'
                          : 'Queued…'}
                      </span>
                    )}
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => void handleDelete(photo.id)}
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg
                               text-white/25 hover:text-red-400 hover:bg-red-500/10
                               transition-all duration-150 opacity-0 group-hover/row:opacity-100"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Opacity slider (only when ready) */}
                {photo.status === 'ready' && (
                  <div className="px-4 pb-3 flex flex-col gap-1 bg-white/[0.015]">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-semibold tracking-widest uppercase text-white/50">
                        Opacity
                      </span>
                      <span className="text-[11px] font-mono text-[#a3d44a]">
                        {Math.round(photo.opacity * 100)}%
                      </span>
                    </div>
                    <div className="relative h-4 flex items-center group/sl">
                      <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.18]" />
                      <div
                        className="absolute left-0 h-[3px] rounded-full bg-[#86B735]/85"
                        style={{ width: `${photo.opacity * 100}%` }}
                      />
                      <div
                        className="absolute w-[13px] h-[13px] rounded-full bg-white shadow-md ring-[1.5px] ring-black/40 pointer-events-none group-hover/sl:scale-[1.2] transition-transform duration-100"
                        style={{ left: `calc(${photo.opacity * 100}% - 6.5px)` }}
                      />
                      <WheelSlider
                        min={0} max={1} step={0.01}
                        value={photo.opacity}
                        onChange={(v) => setOpacity(photo.id, v)}
                        className="absolute inset-x-0 opacity-0 h-4 w-full cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
