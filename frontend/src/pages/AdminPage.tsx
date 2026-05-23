/**
 * AdminPage — Backoffice for uploading and managing models & orthophotos.
 * Route: /admin
 */
import { useState, useEffect, useRef, useCallback, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import {
  LayoutDashboard, Box, Map, Upload, Trash2, ExternalLink,
  RefreshCw, AlertCircle, CheckCircle2, Loader2, X, ChevronRight,
  FileImage, Globe, Eye, Info, LogOut, Bell, Copy, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  listModels, deleteModel, presignUpload, uploadToSpaces, createModel,
  listOrthophotos, deleteOrthophoto, presignOrthophotoUpload, createOrthophoto,
  login, getMe, getAgeInfo,
} from '@/lib/api'
import type { Model, Orthophoto, CreateOrthophotoPayload } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminTab = 'dashboard' | 'models' | 'orthophotos' | 'cog-convert' | 'reminders'

interface Toast {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

// ─── CRS presets (matches UploadDialog) ──────────────────────────────────────

const CRS_PRESETS = [
  { value: 'unknown',  label: 'Unknown / manual slider',              offset: 0,    hint: 'Use the height offset slider after loading' },
  { value: 'wgs84',   label: 'WGS84 Ellipsoidal (no offset)',         offset: 0,    hint: 'Heights already in WGS84 — no correction needed' },
  { value: 'itm',     label: 'Israel ITM / IG05 (ContextCapture/DJI)', offset: -17.5, hint: 'Auto-applies −17.5 m geoid correction for Israel' },
  { value: 'custom',  label: 'Custom geoid offset…',                  offset: null, hint: 'Enter your own geoid undulation value in metres' },
] as const

function resolveCrs(crsValue: string, customOffset: string) {
  const preset = CRS_PRESETS.find((p) => p.value === crsValue) ?? CRS_PRESETS[0]
  const geoid_offset = preset.offset !== null ? preset.offset : parseFloat(customOffset) || 0
  return { coordinate_system: crsValue, geoid_offset }
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let n = bytes; let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${units[i]}`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatCoord(v: number | null, decimals = 6) {
  if (v === null || v === undefined) return '—'
  return v.toFixed(decimals)
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function Field({
  label, value, onChange, type = 'text', placeholder, step, required, hint, className,
}: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string; step?: string; required?: boolean; hint?: string; className?: string
}) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium text-white/50">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      <input
        type={type} step={step} value={value} placeholder={placeholder} required={required}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="h-8 rounded-md border border-white/10 bg-white/5 px-2.5 text-sm text-white
                   placeholder:text-white/20 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
      />
      {hint && <span className="text-[11px] text-white/30 leading-tight">{hint}</span>}
    </label>
  )
}

function Select({
  label, value, onChange, options, hint,
}: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; hint?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-white/50">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-white/10 bg-[#0d1220] px-2.5 text-sm text-white
                   focus:outline-none focus:border-indigo-500 transition-colors"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="text-[11px] text-white/30 leading-tight">{hint}</span>}
    </label>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    ready:      { label: 'Ready',      cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', icon: <CheckCircle2 size={11} /> },
    processing: { label: 'Processing', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/20',      icon: <Loader2 size={11} className="animate-spin" /> },
    pending:    { label: 'Pending',    cls: 'bg-blue-500/15 text-blue-400 border-blue-500/20',         icon: <Loader2 size={11} className="animate-spin" /> },
    error:      { label: 'Error',      cls: 'bg-red-500/15 text-red-400 border-red-500/20',            icon: <AlertCircle size={11} /> },
  }
  const s = map[status] ?? map.pending
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium', s.cls)}>
      {s.icon}{s.label}
    </span>
  )
}

function AgeBadge({ createdAt }: { createdAt: string }) {
  const { days, status } = getAgeInfo(createdAt)
  const cls =
    status === 'overdue' ? 'bg-red-500/15 text-red-400 border-red-500/20' :
    status === 'warning' ? 'bg-amber-500/15 text-amber-400 border-amber-500/20' :
                           'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
  const label =
    status === 'overdue' ? `${days}d 🔴` :
    status === 'warning' ? `${days}d ⚠` :
                           `${days}d`
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium', cls)}>
      {label}
    </span>
  )
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({
  accept, onFile, label, sublabel,
}: {
  accept: string; onFile: (f: File) => void; label: string; sublabel?: string
}) {
  const [dragging, setDragging] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  function handle(f: File) { onFile(f) }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handle(f)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => ref.current?.click()}
      className={cn(
        'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 py-8 px-4 text-center select-none',
        dragging ? 'border-indigo-400 bg-indigo-500/10' : 'border-white/10 hover:border-white/25 hover:bg-white/[0.03]',
      )}
    >
      <Upload size={24} className={cn('transition-colors', dragging ? 'text-indigo-400' : 'text-white/30')} />
      <span className="text-sm font-medium text-white/70">{label}</span>
      {sublabel && <span className="text-[11px] text-white/30">{sublabel}</span>}
      <input ref={ref} type="file" accept={accept} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) { handle(f); e.target.value = '' } }} />
    </div>
  )
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-xl rounded-2xl border border-white/10 bg-[#0d1220] shadow-2xl shadow-black/80 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <span className="text-sm font-semibold text-white">{title}</span>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-white/10 text-white/50 hover:text-white transition-colors">
            <X size={15} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

// ─── Toast system ─────────────────────────────────────────────────────────────

function ToastStack({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id}
          className={cn(
            'flex items-center gap-2.5 pl-3 pr-2 py-2.5 rounded-xl border shadow-2xl pointer-events-auto',
            t.type === 'success' && 'bg-emerald-950/90 border-emerald-500/30 text-emerald-300',
            t.type === 'error'   && 'bg-red-950/90 border-red-500/30 text-red-300',
            t.type === 'info'    && 'bg-indigo-950/90 border-indigo-500/30 text-indigo-300',
          )}
        >
          {t.type === 'success' && <CheckCircle2 size={14} />}
          {t.type === 'error'   && <AlertCircle size={14} />}
          {t.type === 'info'    && <Info size={14} />}
          <span className="text-xs font-medium max-w-xs">{t.message}</span>
          <button onClick={() => onRemove(t.id)} className="ml-1 opacity-60 hover:opacity-100 transition-opacity">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)
  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const add = useCallback((type: Toast['type'], message: string) => {
    const id = ++counter.current
    setToasts((t) => [...t, { id, type, message }])
    setTimeout(() => remove(id), 5000)
  }, [remove])
  return { toasts, add, remove }
}

// ─── Upload Model Modal ───────────────────────────────────────────────────────

type ModelInputMode = 'file' | 'url'

function UploadModelModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [mode, setMode] = useState<ModelInputMode>('file')
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tilesUrl, setTilesUrl] = useState('')
  const [lon, setLon] = useState('0')
  const [lat, setLat] = useState('0')
  const [alt, setAlt] = useState('0')
  const [heading, setHeading] = useState('0')
  const [pitch, setPitch] = useState('0')
  const [roll, setRoll] = useState('0')
  const [scale, setScale] = useState('1')
  const [crsValue, setCrsValue] = useState('itm')
  const [customOffset, setCustomOffset] = useState('-17.5')
  const [showTransform, setShowTransform] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  function handleFileDrop(f: File) {
    setFile(f)
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setUploading(true)
    try {
      const { coordinate_system, geoid_offset } = resolveCrs(crsValue, customOffset)
      if (mode === 'file') {
        if (!file) throw new Error('No file selected')
        const ct = file.name.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json'
        const { key, url } = await presignUpload(file.name, ct)
        setProgress(10)
        await uploadToSpaces(url, file, (p) => setProgress(10 + p * 0.85))
        setProgress(95)
        await createModel({
          name, description: description || undefined, file_key: key,
          file_size: file.size, file_type: ct,
          longitude: parseFloat(lon), latitude: parseFloat(lat), altitude: parseFloat(alt),
          heading: parseFloat(heading), pitch: parseFloat(pitch), roll: parseFloat(roll),
          scale: parseFloat(scale), coordinate_system, geoid_offset,
        })
      } else {
        if (!tilesUrl) throw new Error('URL is required')
        if (!tilesUrl.endsWith('.json')) throw new Error('URL must point to a .json tileset file (e.g. tileset.json)')
        await createModel({
          name, description: description || undefined,
          external_url: tilesUrl, model_type: '3d-tiles',
          longitude: parseFloat(lon), latitude: parseFloat(lat), altitude: parseFloat(alt),
          coordinate_system, geoid_offset,
        })
      }
      setProgress(100)
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  const crsPreset = CRS_PRESETS.find((p) => p.value === crsValue)!

  return (
    <Modal title="Upload Model" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Mode switcher */}
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          {(['file', 'url'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(null) }}
              className={cn('flex-1 py-2 text-xs font-medium transition-colors',
                mode === m ? 'bg-indigo-600 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'
              )}>
              {m === 'file' ? '📁 File Upload (GLB / GLTF)' : '🔗 3D Tiles URL'}
            </button>
          ))}
        </div>

        {/* File drop / URL input */}
        {mode === 'file' ? (
          file ? (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10">
              <Box size={18} className="text-indigo-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{file.name}</p>
                <p className="text-[11px] text-white/40">{formatBytes(file.size)}</p>
              </div>
              <button type="button" onClick={() => setFile(null)} className="text-white/30 hover:text-red-400 transition-colors"><X size={14} /></button>
            </div>
          ) : (
            <DropZone accept=".glb,.gltf" onFile={handleFileDrop} label="Drop GLB / GLTF here or click to browse" sublabel=".glb, .gltf — max 2 GB" />
          )
        ) : (
          <Field label="Tileset URL" value={tilesUrl} onChange={setTilesUrl} required
            placeholder="https://example.com/tileset/tileset.json"
            hint="Must point directly to the root .json tileset file" />
        )}

        {/* Name + description */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" value={name} onChange={setName} required className="col-span-2" />
          <Field label="Description" value={description} onChange={setDescription} placeholder="Optional" className="col-span-2" />
        </div>

        {/* CRS */}
        <Select
          label="Coordinate System"
          value={crsValue}
          onChange={setCrsValue}
          options={CRS_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
          hint={crsPreset.hint}
        />
        {crsValue === 'custom' && (
          <Field label="Geoid Offset (m)" value={customOffset} onChange={setCustomOffset} type="number" step="0.1" />
        )}

        {/* Transform (collapsible) */}
        <div>
          <button type="button" onClick={() => setShowTransform((s) => !s)}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors">
            <ChevronRight size={13} className={cn('transition-transform', showTransform && 'rotate-90')} />
            Position &amp; Orientation
          </button>
          {showTransform && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Field label="Longitude (°)" value={lon} onChange={setLon} type="number" step="any" />
              <Field label="Latitude (°)" value={lat} onChange={setLat} type="number" step="any" />
              <Field label="Altitude (m)" value={alt} onChange={setAlt} type="number" step="any" />
              <Field label="Heading (°)" value={heading} onChange={setHeading} type="number" step="any" />
              <Field label="Pitch (°)" value={pitch} onChange={setPitch} type="number" step="any" />
              <Field label="Roll (°)" value={roll} onChange={setRoll} type="number" step="any" />
              <Field label="Scale" value={scale} onChange={setScale} type="number" step="any" />
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />{error}
          </div>
        )}

        {uploading && <ProgressBar pct={progress} />}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={uploading}
            className="flex-1 h-9 rounded-lg border border-white/10 text-xs font-medium text-white/60 hover:text-white hover:border-white/25 transition-colors disabled:opacity-40">
            Cancel
          </button>
          <button type="submit" disabled={uploading || (mode === 'file' && !file)}
            className="flex-1 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
            {uploading ? <><Loader2 size={13} className="animate-spin" />Uploading…</> : <><Upload size={13} />Upload</>}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Upload Orthophoto Modal ──────────────────────────────────────────────────

const ORTHO_FORMATS: Record<string, string> = {
  'tif': 'GeoTIFF', 'tiff': 'GeoTIFF', 'ecw': 'ECW', 'jp2': 'JPEG2000',
  'j2k': 'JPEG2000', 'sid': 'MrSID',
}

function UploadOrthophotoModal({ onClose, onCreated }: { onClose: () => void; onCreated: (o: Orthophoto) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cogReady, setCogReady] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  function handleFileDrop(f: File) {
    setFile(f)
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setError(null)
    setUploading(true)
    setProgress(0)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'tif'
      const original_format = ORTHO_FORMATS[ext] ?? ext.toUpperCase()
      const ct = 'application/octet-stream'
      const { key, url } = await presignOrthophotoUpload(file.name, ct)
      setProgress(5)
      await uploadToSpaces(url, file, (p) => setProgress(5 + p * 0.9))
      setProgress(95)
      const ortho = await createOrthophoto({ name, description: description || undefined, raw_key: key, original_format, cog_ready: cogReady || undefined } satisfies CreateOrthophotoPayload)
      setProgress(100)
      onCreated(ortho)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Modal title="Upload Orthophoto" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {file ? (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
            <FileImage size={18} className="text-emerald-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{file.name}</p>
              <p className="text-[11px] text-white/40">{formatBytes(file.size)} · {ORTHO_FORMATS[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? 'Raster'}</p>
            </div>
            <button type="button" onClick={() => setFile(null)} className="text-white/30 hover:text-red-400 transition-colors"><X size={14} /></button>
          </div>
        ) : (
          <DropZone
            accept=".tif,.tiff,.ecw,.jp2,.j2k,.sid"
            onFile={handleFileDrop}
            label="Drop orthophoto here or click to browse"
            sublabel="GeoTIFF · ECW · JPEG2000 · MrSID"
          />
        )}

        <Field label="Name" value={name} onChange={setName} required />
        <Field label="Description" value={description} onChange={setDescription} placeholder="Optional notes" />

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={cogReady}
            onChange={(e) => setCogReady(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-white/5 accent-emerald-500"
          />
          <span className="text-xs text-white/60">
            File is already a Cloud-Optimized GeoTIFF in EPSG:3857
            <span className="text-white/30"> (skip server-side processing)</span>
          </span>
        </label>

        <div className={cn(
          'flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs',
          cogReady
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
            : 'bg-blue-500/10 border-blue-500/20 text-blue-300',
        )}>
          <Info size={13} className="mt-0.5 shrink-0" />
          {cogReady
            ? <span>File will be registered as-is — bounds and zoom level will be read directly from the COG. No server-side processing.</span>
            : <span>The file will be reprojected to Web Mercator and converted to Cloud-Optimized GeoTIFF on the server. Processing may take a few minutes for large files.</span>
          }
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />{error}
          </div>
        )}

        {uploading && <ProgressBar pct={progress} />}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={uploading}
            className="flex-1 h-9 rounded-lg border border-white/10 text-xs font-medium text-white/60 hover:text-white hover:border-white/25 transition-colors disabled:opacity-40">
            Cancel
          </button>
          <button type="submit" disabled={uploading || !file}
            className="flex-1 h-9 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
            {uploading ? <><Loader2 size={13} className="animate-spin" />Uploading…</> : <><Upload size={13} />Upload &amp; Process</>}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4">
      <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40 shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
        <p className="text-xs text-white/40">{label}</p>
        {sub && <p className="text-[11px] text-white/25 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function DashboardTab({ models, orthophotos }: { models: Model[]; orthophotos: Orthophoto[] }) {
  const totalSize = models.reduce((s, m) => s + (m.file_size ?? 0), 0)
  const readyOrthos = orthophotos.filter((o) => o.status === 'ready').length
  const processingOrthos = orthophotos.filter((o) => o.status === 'processing' || o.status === 'pending').length
  const recentModels = [...models].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)
  const recentOrthos = [...orthophotos].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Box size={20} />} label="Total Models" value={models.length}
          sub={formatBytes(totalSize) + ' stored'} />
        <StatCard icon={<Globe size={20} />} label="3D Tiles Models"
          value={models.filter((m) => m.model_type === '3d-tiles').length} />
        <StatCard icon={<Map size={20} />} label="Orthophotos" value={orthophotos.length}
          sub={readyOrthos + ' ready'} />
        {processingOrthos > 0 && (
          <StatCard icon={<Loader2 size={20} className="animate-spin" />}
            label="Processing" value={processingOrthos} sub="orthophotos in queue" />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent models */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <Box size={14} className="text-white/40" />
            <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">Recent Models</span>
          </div>
          {recentModels.length === 0 ? (
            <p className="px-4 py-6 text-xs text-white/30 text-center">No models uploaded yet</p>
          ) : (
            <div className="divide-y divide-white/5">
              {recentModels.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Box size={14} className="text-indigo-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{m.name}</p>
                    <p className="text-[11px] text-white/30">{m.model_type.toUpperCase()} · {fmtDate(m.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent orthophotos */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <Map size={14} className="text-white/40" />
            <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">Recent Orthophotos</span>
          </div>
          {recentOrthos.length === 0 ? (
            <p className="px-4 py-6 text-xs text-white/30 text-center">No orthophotos uploaded yet</p>
          ) : (
            <div className="divide-y divide-white/5">
              {recentOrthos.map((o) => (
                <div key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                  <FileImage size={14} className="text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{o.name}</p>
                    <p className="text-[11px] text-white/30">{o.original_format ?? 'Raster'} · {fmtDate(o.created_at)}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Models Tab ───────────────────────────────────────────────────────────────

function ModelsTab({
  models, loading, onRefresh, onDelete, onUpload, toast,
}: {
  models: Model[]; loading: boolean
  onRefresh: () => void; onDelete: (id: string) => void; onUpload: () => void
  toast: (type: Toast['type'], msg: string) => void
}) {
  async function handleDelete(m: Model) {
    if (!confirm(`Delete model "${m.name}"? This cannot be undone.`)) return
    try { await deleteModel(m.id); onDelete(m.id); toast('success', `Deleted "${m.name}"`) }
    catch (err) { toast('error', err instanceof Error ? err.message : 'Delete failed') }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40">{models.length} model{models.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} disabled={loading}
            className="h-8 px-3 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white hover:border-white/25 transition-colors flex items-center gap-1.5 disabled:opacity-40">
            <RefreshCw size={12} className={cn(loading && 'animate-spin')} /> Refresh
          </button>
          <button onClick={onUpload}
            className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors flex items-center gap-1.5">
            <Upload size={12} /> Upload Model
          </button>
        </div>
      </div>

      {loading && models.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-xs text-white/30 gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : models.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Box size={32} className="text-white/10" />
          <p className="text-sm text-white/40">No models uploaded yet.</p>
          <button onClick={onUpload} className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors">
            Upload your first model →
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="text-left px-4 py-2.5 text-white/40 font-medium">Name</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden sm:table-cell">Type</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden md:table-cell">Size</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden lg:table-cell">Coordinates</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden md:table-cell">CRS</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden sm:table-cell">Added</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden sm:table-cell">Age</th>
                <th className="text-right px-4 py-2.5 text-white/40 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {models.map((m) => (
                <tr key={m.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {m.model_type === '3d-tiles' ? <Globe size={13} className="text-violet-400 shrink-0" /> : <Box size={13} className="text-indigo-400 shrink-0" />}
                      <span className="font-medium text-white max-w-[180px] truncate">{m.name}</span>
                    </div>
                    {m.description && <p className="text-[11px] text-white/30 ml-5 truncate max-w-[180px]">{m.description}</p>}
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-medium',
                      m.model_type === '3d-tiles' ? 'bg-violet-500/15 text-violet-400' : 'bg-indigo-500/15 text-indigo-400')}>
                      {m.model_type === 'gltf' ? 'GLB/GLTF' : m.model_type === '3d-tiles' ? '3D Tiles' : m.model_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-white/40 hidden md:table-cell">{formatBytes(m.file_size)}</td>
                  <td className="px-4 py-2.5 text-white/40 hidden lg:table-cell font-mono text-[11px]">
                    {formatCoord(m.longitude, 4)}°, {formatCoord(m.latitude, 4)}°
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="text-[11px] text-white/30 uppercase">{m.coordinate_system}</span>
                  </td>
                  <td className="px-4 py-2.5 text-white/30 hidden sm:table-cell">{fmtDate(m.created_at)}</td>
                  <td className="px-4 py-2.5 hidden sm:table-cell"><AgeBadge createdAt={m.created_at} /></td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
                      <a
                        href={`/app`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in viewer"
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-white/10 text-white/30 hover:text-white transition-colors"
                      >
                        <Eye size={13} />
                      </a>
                      <button
                        title="Delete model"
                        onClick={() => handleDelete(m)}
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-red-500/10 text-white/30 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Orthophotos Tab ──────────────────────────────────────────────────────────

function OrthophotosTab({
  orthophotos, loading, onRefresh, onDelete, onUpload, toast,
}: {
  orthophotos: Orthophoto[]; loading: boolean
  onRefresh: () => void; onDelete: (id: string) => void; onUpload: () => void
  toast: (type: Toast['type'], msg: string) => void
}) {
  // Poll processing items every 5 s
  const processingIds = orthophotos.filter((o) => o.status === 'processing' || o.status === 'pending').map((o) => o.id)
  useEffect(() => {
    if (processingIds.length === 0) return
    const id = setTimeout(() => onRefresh(), 5000)
    return () => clearTimeout(id)
  }, [processingIds.join(','), onRefresh])

  async function handleDelete(o: Orthophoto) {
    if (!confirm(`Delete orthophoto "${o.name}"? This cannot be undone.`)) return
    try { await deleteOrthophoto(o.id); onDelete(o.id); toast('success', `Deleted "${o.name}"`) }
    catch (err) { toast('error', err instanceof Error ? err.message : 'Delete failed') }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40">{orthophotos.length} orthophoto{orthophotos.length !== 1 ? 's' : ''}</span>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} disabled={loading}
            className="h-8 px-3 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white hover:border-white/25 transition-colors flex items-center gap-1.5 disabled:opacity-40">
            <RefreshCw size={12} className={cn(loading && 'animate-spin')} /> Refresh
          </button>
          <button onClick={onUpload}
            className="h-8 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold text-white transition-colors flex items-center gap-1.5">
            <Upload size={12} /> Upload Orthophoto
          </button>
        </div>
      </div>

      {loading && orthophotos.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-xs text-white/30 gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : orthophotos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Map size={32} className="text-white/10" />
          <p className="text-sm text-white/40">No orthophotos uploaded yet.</p>
          <button onClick={onUpload} className="text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition-colors">
            Upload your first orthophoto →
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className="text-left px-4 py-2.5 text-white/40 font-medium">Name</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden sm:table-cell">Format</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden lg:table-cell">Bounds (W/S/E/N)</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden sm:table-cell">Added</th>
                <th className="text-left px-4 py-2.5 text-white/40 font-medium hidden sm:table-cell">Age</th>
                <th className="text-right px-4 py-2.5 text-white/40 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {orthophotos.map((o) => (
                <tr key={o.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileImage size={13} className="text-emerald-400 shrink-0" />
                      <span className="font-medium text-white max-w-[180px] truncate">{o.name}</span>
                    </div>
                    {o.error_message && <p className="text-[11px] text-red-400 ml-5 truncate max-w-[240px]" title={o.error_message}>{o.error_message}</p>}
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[11px] font-medium">
                      {o.original_format ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-2.5 hidden lg:table-cell font-mono text-[11px] text-white/40">
                    {o.bounds_west !== null
                      ? `${formatCoord(o.bounds_west, 4)} / ${formatCoord(o.bounds_south, 4)} / ${formatCoord(o.bounds_east, 4)} / ${formatCoord(o.bounds_north, 4)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-white/30 hidden sm:table-cell">{fmtDate(o.created_at)}</td>
                  <td className="px-4 py-2.5 hidden sm:table-cell"><AgeBadge createdAt={o.created_at} /></td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        title="Delete orthophoto"
                        onClick={() => handleDelete(o)}
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-red-500/10 text-white/30 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── COG Converter Tab ────────────────────────────────────────────────────────

function CogConverterTab({
  onCreated, toast,
}: {
  onCreated: (o: Orthophoto) => void
  toast: (type: Toast['type'], msg: string) => void
}) {
  const [inputFile,  setInputFile]  = useState('input.tif')
  const [outputFile, setOutputFile] = useState('output_cog.tif')
  const [copied, setCopied] = useState(false)

  const [file,      setFile]      = useState<File | null>(null)
  const [name,      setName]      = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [error,     setError]     = useState<string | null>(null)

  const command = `gdalwarp -t_srs EPSG:3857 -r bilinear -of COG -co COMPRESS=LZW -co OVERVIEW_LEVEL=AUTO -co BIGTIFF=IF_SAFER "${inputFile}" "${outputFile}"`

  function copyCommand() {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleFileDrop(f: File) {
    setFile(f)
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setError(null)
    setUploading(true)
    setProgress(0)
    try {
      const { key, url } = await presignOrthophotoUpload(file.name, 'application/octet-stream')
      setProgress(5)
      await uploadToSpaces(url, file, (p) => setProgress(5 + p * 0.9))
      setProgress(95)
      const ortho = await createOrthophoto({
        name,
        raw_key: key,
        original_format: 'GeoTIFF',
        cog_ready: true,
      } satisfies CreateOrthophotoPayload)
      setProgress(100)
      onCreated(ortho)
      toast('success', `"${ortho.name}" registered — no processing needed`)
      setFile(null)
      setName('')
      setProgress(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Step 1 */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="h-5 w-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
          <h2 className="text-sm font-semibold text-white">Convert locally with GDAL</h2>
        </div>
        <p className="text-xs text-white/40">
          Run this command on your machine to produce a Cloud-Optimized GeoTIFF in EPSG:3857.
          Faster than server-side conversion for large files.
          Requires GDAL installed.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Input file path" value={inputFile} onChange={setInputFile} placeholder="input.tif" />
          <Field label="Output file path" value={outputFile} onChange={setOutputFile} placeholder="output_cog.tif" />
        </div>

        <div className="relative">
          <pre className="text-[11px] font-mono text-emerald-300 bg-black/50 border border-white/10 rounded-lg px-4 py-3 pr-20 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed select-all">
            {command}
          </pre>
          <button
            type="button"
            onClick={copyCommand}
            className="absolute top-2 right-2 h-7 px-2.5 rounded-md bg-white/10 hover:bg-white/20 text-xs text-white/60 hover:text-white transition-colors flex items-center gap-1.5"
          >
            {copied
              ? <><CheckCircle2 size={11} className="text-emerald-400" />Copied</>
              : <><Copy size={11} />Copy</>}
          </button>
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>
            Install GDAL:{' '}
            <code className="font-mono bg-white/10 px-1 rounded">conda install gdal</code>
            {' · '}
            <code className="font-mono bg-white/10 px-1 rounded">apt install gdal-bin</code>
            {' · '}
            OSGeo4W on Windows
          </span>
        </div>
      </div>

      {/* Step 2 */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="h-5 w-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
          <h2 className="text-sm font-semibold text-white">Upload converted COG</h2>
        </div>
        <p className="text-xs text-white/40">
          Upload the output file. It will be registered instantly — no server-side processing.
        </p>

        <form onSubmit={(e) => { void handleUpload(e) }} className="flex flex-col gap-4">
          {file ? (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
              <FileImage size={18} className="text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">{file.name}</p>
                <p className="text-[11px] text-white/40">{formatBytes(file.size)}</p>
              </div>
              <button type="button" onClick={() => setFile(null)} className="text-white/30 hover:text-red-400 transition-colors">
                <X size={14} />
              </button>
            </div>
          ) : (
            <DropZone
              accept=".tif,.tiff"
              onFile={handleFileDrop}
              label="Drop converted COG here or click to browse"
              sublabel="Must be a GeoTIFF COG in EPSG:3857"
            />
          )}

          <Field label="Name" value={name} onChange={setName} required placeholder="Beer Yaakov 2026" />

          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />{error}
            </div>
          )}
          {uploading && <ProgressBar pct={progress} />}

          <button
            type="submit"
            disabled={uploading || !file || !name.trim()}
            className="h-9 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {uploading
              ? <><Loader2 size={13} className="animate-spin" />Uploading…</>
              : <><Upload size={13} />Upload COG</>}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Reminders Tab ────────────────────────────────────────────────────────────

function RemindersTab({ models, orthophotos }: { models: Model[]; orthophotos: Orthophoto[] }) {
  const flaggedModels  = models.filter((m) => getAgeInfo(m.created_at).status !== 'ok')
  const flaggedOrthos  = orthophotos.filter((o) => getAgeInfo(o.created_at).status !== 'ok')
  const allFlagged     = flaggedModels.length + flaggedOrthos.length

  if (allFlagged === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <CheckCircle2 size={32} className="text-emerald-400" />
        <p className="text-sm text-white/50">All items are up to date ✓</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-white/40">
        {allFlagged} item{allFlagged !== 1 ? 's' : ''} approaching or past the 1-year mark
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {flaggedModels.map((m) => {
          const { days, status } = getAgeInfo(m.created_at)
          return (
            <div key={m.id} className={cn(
              'rounded-xl border px-4 py-3 flex flex-col gap-1.5',
              status === 'overdue' ? 'border-red-500/25 bg-red-500/5' : 'border-amber-500/25 bg-amber-500/5',
            )}>
              <div className="flex items-center gap-2">
                <Box size={13} className="text-indigo-400 shrink-0" />
                <span className="text-xs font-medium text-white truncate">{m.name}</span>
              </div>
              <p className="text-[11px] text-white/40">3D Model · {m.model_type.toUpperCase()}</p>
              <AgeBadge createdAt={m.created_at} />
              <p className="text-[11px] text-white/30">{days} days old · added {fmtDate(m.created_at)}</p>
            </div>
          )
        })}
        {flaggedOrthos.map((o) => {
          const { days, status } = getAgeInfo(o.created_at)
          return (
            <div key={o.id} className={cn(
              'rounded-xl border px-4 py-3 flex flex-col gap-1.5',
              status === 'overdue' ? 'border-red-500/25 bg-red-500/5' : 'border-amber-500/25 bg-amber-500/5',
            )}>
              <div className="flex items-center gap-2">
                <FileImage size={13} className="text-emerald-400 shrink-0" />
                <span className="text-xs font-medium text-white truncate">{o.name}</span>
              </div>
              <p className="text-[11px] text-white/40">Orthophoto · {o.original_format ?? 'Raster'}</p>
              <AgeBadge createdAt={o.created_at} />
              <p className="text-[11px] text-white/30">{days} days old · added {fmtDate(o.created_at)}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Admin Page ───────────────────────────────────────────────────────────────

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard')
  const [models, setModels] = useState<Model[]>([])
  const [orthophotos, setOrthophotos] = useState<Orthophoto[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [orthosLoading, setOrthosLoading] = useState(false)
  const [showUploadModel, setShowUploadModel] = useState(false)
  const [showUploadOrtho, setShowUploadOrtho] = useState(false)
  const { toasts, add: addToast, remove: removeToast } = useToasts()

  // ── Auth state ─────────────────────────────────────────────────────────────
  const [authed, setAuthed]           = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError]   = useState('')
  const [loginBusy, setLoginBusy]     = useState(false)

  useEffect(() => {
    getMe()
      .then(() => setAuthed(true))
      .catch(() => { localStorage.removeItem('admin_token'); setAuthed(false) })
      .finally(() => setAuthChecked(true))
  }, [])

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setLoginError(''); setLoginBusy(true)
    try {
      const { token } = await login(loginUsername, loginPassword)
      localStorage.setItem('admin_token', token)
      setAuthed(true)
    } catch {
      setLoginError('Invalid username or password')
    } finally {
      setLoginBusy(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('admin_token')
    setAuthed(false)
    setAuthChecked(true)
  }

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchModels = useCallback(async () => {
    setModelsLoading(true)
    try { setModels(await listModels()) }
    catch { addToast('error', 'Failed to load models') }
    finally { setModelsLoading(false) }
  }, [addToast])

  const fetchOrthos = useCallback(async () => {
    setOrthosLoading(true)
    try { setOrthophotos(await listOrthophotos()) }
    catch { addToast('error', 'Failed to load orthophotos') }
    finally { setOrthosLoading(false) }
  }, [addToast])

  useEffect(() => {
    if (authed) { void fetchModels(); void fetchOrthos() }
  }, [authed, fetchModels, fetchOrthos])

  const hasReminders =
    models.some((m) => getAgeInfo(m.created_at).status !== 'ok') ||
    orthophotos.some((o) => getAgeInfo(o.created_at).status !== 'ok')

  const NAV: { tab: AdminTab; icon: React.ReactNode; label: string; dot?: boolean }[] = [
    { tab: 'dashboard',   icon: <LayoutDashboard size={15} />, label: 'Dashboard' },
    { tab: 'models',      icon: <Box size={15} />,             label: 'Models' },
    { tab: 'orthophotos', icon: <Map size={15} />,             label: 'Orthophotos' },
    { tab: 'cog-convert', icon: <Zap size={15} />,             label: 'COG Convert' },
    { tab: 'reminders',   icon: <Bell size={15} />,            label: 'Reminders', dot: hasReminders },
  ]

  // ── Spinner while auth check in flight ─────────────────────────────────────
  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-svh bg-[#070a12]">
        <Loader2 size={22} className="animate-spin text-white/30" />
      </div>
    )
  }

  // ── Login card ─────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="flex items-center justify-center h-svh bg-[#070a12] text-white">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d1220] shadow-2xl shadow-black/80 p-8 flex flex-col gap-5">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="h-8 w-8 rounded-xl bg-indigo-600 flex items-center justify-center">
              <Globe size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white tracking-tight">3D Viewer Admin</p>
              <p className="text-[11px] text-white/40">Sign in to continue</p>
            </div>
          </div>
          <form onSubmit={(e) => { void handleLogin(e) }} className="flex flex-col gap-3">
            <Field label="Username" value={loginUsername} onChange={setLoginUsername} required />
            <Field label="Password" value={loginPassword} onChange={setLoginPassword} type="password" required />
            {loginError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                <AlertCircle size={12} className="shrink-0" />{loginError}
              </div>
            )}
            <button type="submit" disabled={loginBusy}
              className="mt-1 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
              {loginBusy ? <Loader2 size={14} className="animate-spin" /> : null}
              Sign in
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-[#070a12] text-white flex flex-col">
      {/* Top bar */}
      <header className="shrink-0 flex items-center gap-4 px-6 py-3 border-b border-white/10 bg-[#0a0e1a]/80 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Globe size={14} className="text-white" />
          </div>
          <span className="text-sm font-bold text-white tracking-tight">3D Viewer</span>
          <span className="text-white/20 mx-1">/</span>
          <span className="text-sm text-white/50 font-medium">Admin</span>
        </div>

        {/* Tab nav */}
        <nav className="flex items-center gap-0.5 ml-4">
          {NAV.map(({ tab, icon, label, dot }) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                activeTab === tab ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white hover:bg-white/5',
              )}>
              {icon}{label}
              {dot && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-red-500" />}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a href="/app" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white hover:border-white/25 transition-colors">
            <ExternalLink size={12} /> Open Viewer
          </a>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white hover:border-white/25 transition-colors">
            <LogOut size={12} /> Log out
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto">
          {activeTab === 'dashboard' && (
            <>
              <h1 className="text-lg font-semibold text-white mb-5">Dashboard</h1>
              <DashboardTab models={models} orthophotos={orthophotos} />
            </>
          )}
          {activeTab === 'models' && (
            <>
              <h1 className="text-lg font-semibold text-white mb-5">Models</h1>
              <ModelsTab
                models={models} loading={modelsLoading}
                onRefresh={fetchModels}
                onDelete={(id) => setModels((ms) => ms.filter((m) => m.id !== id))}
                onUpload={() => setShowUploadModel(true)}
                toast={addToast}
              />
            </>
          )}
          {activeTab === 'orthophotos' && (
            <>
              <h1 className="text-lg font-semibold text-white mb-5">Orthophotos</h1>
              <OrthophotosTab
                orthophotos={orthophotos} loading={orthosLoading}
                onRefresh={fetchOrthos}
                onDelete={(id) => setOrthophotos((os) => os.filter((o) => o.id !== id))}
                onUpload={() => setShowUploadOrtho(true)}
                toast={addToast}
              />
            </>
          )}
          {activeTab === 'cog-convert' && (
            <>
              <h1 className="text-lg font-semibold text-white mb-5">COG Converter</h1>
              <CogConverterTab
                onCreated={(o) => {
                  setOrthophotos((os) => [o, ...os])
                  setActiveTab('orthophotos')
                }}
                toast={addToast}
              />
            </>
          )}
          {activeTab === 'reminders' && (
            <>
              <h1 className="text-lg font-semibold text-white mb-5">Reminders</h1>
              <RemindersTab models={models} orthophotos={orthophotos} />
            </>
          )}
        </div>
      </main>

      {/* Modals */}
      {showUploadModel && (
        <UploadModelModal
          onClose={() => setShowUploadModel(false)}
          onSuccess={() => { addToast('success', 'Model uploaded successfully'); void fetchModels() }}
        />
      )}
      {showUploadOrtho && (
        <UploadOrthophotoModal
          onClose={() => setShowUploadOrtho(false)}
          onCreated={(o) => {
            addToast('info', `"${o.name}" uploaded — processing started`)
            setOrthophotos((os) => [o, ...os])
            setActiveTab('orthophotos')
          }}
        />
      )}

      <ToastStack toasts={toasts} onRemove={removeToast} />
    </div>
  )
}
