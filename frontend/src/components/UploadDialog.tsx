import { useState, useRef, useEffect, type ChangeEvent, type FormEvent } from 'react'
import { cn } from '@/lib/utils'
import { presignUpload, uploadToSpaces, createModel, listModels, type Model } from '@/lib/api'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

type ModelInputMode = 'file' | '3d-tiles'

const ACCEPTED = '.glb,.gltf'

// ── CRS presets ──────────────────────────────────────────────────────────────
interface CrsPreset {
  value: string
  label: string
  offset: number | null   // null = user enters custom value
  hint: string
}
const CRS_PRESETS: CrsPreset[] = [
  { value: 'unknown',  label: 'Unknown / manual slider',        offset: 0,    hint: 'Use the height offset slider after loading' },
  { value: 'wgs84',   label: 'WGS84 Ellipsoidal (no offset)',   offset: 0,    hint: 'Heights already in WGS84 — no correction needed' },
  { value: 'itm',     label: 'Israel ITM / IG05 (ContextCapture / DJI)', offset: -17.5, hint: 'Auto-applies −17.5 m geoid correction for Israel' },
  { value: 'custom',  label: 'Custom geoid offset…',            offset: null, hint: 'Enter your own geoid undulation value in metres' },
]

function Field({
  label, value, onChange, type = 'text', required = false, step, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  step?: string
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      <input
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        required={required}
        className="h-8 rounded-md border border-input bg-background px-2.5 text-sm
                   focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  )
}

export function UploadDialog({ onClose, onSuccess }: Props) {
  const [inputMode, setInputMode] = useState<ModelInputMode>('file')
  const [assetName, setAssetName] = useState('')
  const [assetMode, setAssetMode] = useState<'select' | 'new'>('select')
  const [models, setModels] = useState<Model[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState<string>('')
    // Fetch all assets (models) on mount
    useEffect(() => {
      listModels().then(setModels).catch(() => setModels([]))
    }, [])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // File-upload mode state
  const [file, setFile] = useState<File | null>(null)
  const [lon, setLon] = useState('0')
  const [lat, setLat] = useState('0')
  const [alt, setAlt] = useState('0')
  const [heading, setHeading] = useState('0')
  const [pitch, setPitch] = useState('0')
  const [roll, setRoll] = useState('0')
  const [scale, setScale] = useState('1')
  const [showTransform, setShowTransform] = useState(false)

  // 3D Tiles URL mode state
  const [tilesUrl, setTilesUrl] = useState('')

  // CRS / coordinate system
  const [crsValue, setCrsValue] = useState('itm')
  const [customOffset, setCustomOffset] = useState('-17.5')

  const [showWatermark, setShowWatermark] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  function resolvedCrs(): { coordinate_system: string; geoid_offset: number } {
    const preset = CRS_PRESETS.find((p) => p.value === crsValue)!
    const geoid_offset = preset.offset !== null ? preset.offset : parseFloat(customOffset) || 0
    return { coordinate_system: crsValue, geoid_offset }
  }

  function switchMode(m: ModelInputMode) {
    setInputMode(m)
    setError(null)
    setFile(null)
    setTilesUrl('')
  }

  // Handle asset selection
  function handleAssetChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    if (value === '__new__') {
      setAssetMode('new')
      setAssetName('')
      setSelectedAssetId('')
    } else {
      setAssetMode('select')
      setSelectedAssetId(value)
      const selected = models.find(m => m.id === value)
      setAssetName(selected ? selected.asset_name : '')
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    // Use assetName from new or selected
    const finalAssetName = assetMode === 'new'
      ? assetName.trim()
      : (models.find(m => m.id === selectedAssetId)?.asset_name || '')

    if (!finalAssetName) {
      setError('Asset name is required')
      return
    }

    try {
      setError(null)
      setUploading(true)
      setProgress(0)

      if (inputMode === '3d-tiles') {
        // Validate URL
        const url = tilesUrl.trim()
        if (!url) { setError('Paste a Cesium.json URL'); setUploading(false); return }
        if (!url.toLowerCase().endsWith('.json')) {
          setError('URL must point to a tileset .json file (e.g. Cesium.json)')
          setUploading(false)
          return
        }
        await createModel({
          asset_name: finalAssetName,
          name: name.trim(),
          description: description.trim() || undefined,
          model_type: '3d-tiles',
          external_url: url,
          show_watermark: showWatermark,
          ...resolvedCrs(),
        })
      } else {
        if (!file) { setError('Select a file first'); setUploading(false); return }

        // 1. Get presigned upload URL
        const { key, presignedUrl } = await presignUpload(file.name, file.type || 'application/octet-stream')
          .then((r) => ({ key: r.key, presignedUrl: r.url }))

        // 2. PUT file directly to Spaces
        await uploadToSpaces(presignedUrl, file, setProgress)

        // 3. Create model record
        await createModel({
          asset_name: finalAssetName,
          name: name.trim(),
          description: description.trim() || undefined,
          file_key: key,
          file_size: file.size,
          file_type: file.type || undefined,
          model_type: 'gltf',
          longitude: parseFloat(lon),
          latitude: parseFloat(lat),
          altitude: parseFloat(alt),
          heading: parseFloat(heading),
          pitch: parseFloat(pitch),
          roll: parseFloat(roll),
          scale: parseFloat(scale),
          show_watermark: showWatermark,
          ...resolvedCrs(),
        })
      }

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setUploading(false)
    }
  }

  const submitDisabled = uploading
    || (assetMode === 'new' ? !assetName.trim() : !selectedAssetId)
    || !name.trim()
    || (inputMode === 'file' ? !file : !tilesUrl.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={!uploading ? onClose : undefined}
      />

      <div className="relative z-10 w-full max-w-md rounded-lg border border-border
                      bg-background shadow-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold">Add 3D Model</h2>
          <button
            onClick={onClose}
            disabled={uploading}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Asset Name Field: select or new */}
        <div className="px-4 pt-4 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Asset Name<span className="text-destructive ml-0.5">*</span></span>
            <select
              value={assetMode === 'new' ? '__new__' : selectedAssetId}
              onChange={handleAssetChange}
              className="h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              disabled={uploading}
            >
              <option value="" disabled>Select existing asset…</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.asset_name}</option>
              ))}
              <option value="__new__">➕ Add new asset…</option>
            </select>
          </label>
          {assetMode === 'new' && (
            <Field
              label="New Asset Name"
              value={assetName}
              onChange={setAssetName}
              required
              placeholder="Enter new asset name"
            />
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex border-b border-border shrink-0">
          {(['file', '3d-tiles'] as ModelInputMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={cn(
                'flex-1 py-2 text-xs font-medium transition-colors',
                inputMode === m
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'file' ? 'Upload File (glTF / GLB)' : 'Link 3D Tiles URL'}
            </button>
          ))}
        </div>

        {/* Body */}
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 p-4 overflow-y-auto">
          <Field label="Name" value={name} onChange={setName} required />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm
                         focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </label>

          {/* ── Coordinate System ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Coordinate System / Height Reference
            </span>
            <select
              value={crsValue}
              onChange={(e) => setCrsValue(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2.5 text-sm
                         focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {CRS_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {(() => {
              const preset = CRS_PRESETS.find((p) => p.value === crsValue)!
              return (
                <p className="text-[11px] text-muted-foreground">{preset.hint}</p>
              )
            })()}
            {crsValue === 'custom' && (
              <label className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground shrink-0">Geoid offset (m):</span>
                <input
                  type="number"
                  step="0.1"
                  value={customOffset}
                  onChange={(e) => setCustomOffset(e.target.value)}
                  className="h-8 w-28 rounded-md border border-input bg-background px-2.5 text-sm
                             focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
            )}
          </div>

          {inputMode === '3d-tiles' ? (
            /* 3D Tiles URL input */
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Tileset URL<span className="text-destructive ml-0.5">*</span>
              </span>
              <input
                type="url"
                value={tilesUrl}
                onChange={(e) => setTilesUrl(e.target.value)}
                placeholder="https://…/Scene/Cesium.json"
                className="h-8 rounded-md border border-input bg-background px-2.5 text-sm
                           focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                Paste the URL to your tileset root (e.g. Cesium.json). Make sure
                CORS is enabled on the storage bucket.
              </p>
            </label>
          ) : (
            <>
              {/* File picker */}
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  File<span className="text-destructive ml-0.5">*</span>
                </span>
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-md border border-dashed border-input px-3 py-2',
                    'cursor-pointer hover:border-ring transition-colors',
                  )}
                  onClick={() => fileRef.current?.click()}
                >
                  <span className="text-sm text-muted-foreground truncate flex-1">
                    {file ? file.name : 'Click to select .glb or .gltf'}
                  </span>
                  {file && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED}
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>

              {/* Position & Transform (collapsible) */}
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setShowTransform((v) => !v)}
                >
                  <span>{showTransform ? '▾' : '▸'}</span>
                  Position &amp; Transform
                </button>

                {showTransform && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Longitude (°)" value={lon} onChange={setLon} type="number" step="any" />
                    <Field label="Latitude (°)"  value={lat} onChange={setLat} type="number" step="any" />
                    <Field label="Altitude (m)"  value={alt} onChange={setAlt} type="number" step="any" />
                    <Field label="Scale"         value={scale} onChange={setScale} type="number" step="any" />
                    <Field label="Heading (°)"   value={heading} onChange={setHeading} type="number" step="any" />
                    <Field label="Pitch (°)"     value={pitch}   onChange={setPitch}   type="number" step="any" />
                    <Field label="Roll (°)"      value={roll}    onChange={setRoll}    type="number" step="any" />
                  </div>
                )}
              </div>
            </>
          )}

          {/* Progress bar (file upload only) */}
          {uploading && inputMode === 'file' && (
            <div className="flex flex-col gap-1">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground text-right">{progress}%</span>
            </div>
          )}

          {/* Watermark toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showWatermark}
              onChange={(e) => setShowWatermark(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <span className="text-xs text-muted-foreground">
              Show watermark on this model
            </span>
          </label>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="h-8 px-3 rounded-md text-sm border border-input hover:bg-accent
                         disabled:opacity-40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="h-8 px-3 rounded-md text-sm bg-primary text-primary-foreground
                         hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {uploading
                ? (inputMode === 'file' ? 'Uploading…' : 'Saving…')
                : (inputMode === 'file' ? 'Upload' : 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}