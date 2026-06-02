import { useParams } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { resolveShareToken, getDownloadUrl, updateModelViaToken } from '@/lib/api'
import type { Model, Orthophoto, ResolvedShare } from '@/lib/api'
import { CesiumViewer } from '@/components/CesiumViewer'
import { MeasureToolbar } from '@/components/MeasureToolbar'
import { VisualControls } from '@/components/VisualControls'
import { MapSwitcher } from '@/components/MapSwitcher'
import { DEFAULT_VISUAL } from '@/lib/visualControls'
import type { MeasureMode } from '@/lib/measure'
import type { VisualSettings } from '@/lib/visualControls'
import type { BaseMap } from '@/components/MapSwitcher'
import type { GeoPoint } from '@/lib/geopoints'
import type { ResolvedOrthophoto } from '@/components/OrthophotoPanel'

function orthoToResolved(o: Orthophoto): ResolvedOrthophoto {
  return {
    id:           o.id,
    asset_name:   o.asset_name?.trim() || o.name,
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

export function SharedViewer() {
  const { token } = useParams<{ token: string }>()
  const [share, setShare] = useState<ResolvedShare | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setErr('Invalid link'); return }
    resolveShareToken(token)
      .then(setShare)
      .catch((e) => {
        setErr('This link is invalid or has been removed.')
        console.error('[SharedViewer] Failed to resolve share token:', e)
      })
  }, [token])

  if (err) {
    return (
      <div className="flex items-center justify-center h-svh bg-background text-foreground">
        <div className="text-center max-w-sm">
          <p className="text-sm text-muted-foreground">{err}</p>
        </div>
      </div>
    )
  }

  if (!share || !token) {
    return (
      <div className="flex items-center justify-center h-svh bg-background text-foreground">
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (share.kind === 'orthophoto') {
    return <OrthoSharedView orthophoto={share.orthophoto} />
  }
  return <ModelSharedView model={share.model} canEdit={share.can_edit} token={token} />
}

// ─── Model-shared view ────────────────────────────────────────────────────────

function ModelSharedView({
  model: initialModel, canEdit, token,
}: { model: Model; canEdit: boolean; token: string }) {
  const safeModel = {
    ...initialModel,
    name: initialModel.name ?? '',
    description: initialModel.description ?? '',
    file_key: initialModel.file_key ?? '',
    file_type: initialModel.file_type ?? '',
    external_url: initialModel.external_url ?? '',
    coordinate_system: initialModel.coordinate_system ?? '',
    geoid_offset: typeof initialModel.geoid_offset === 'number' ? initialModel.geoid_offset : 0,
    show_watermark: typeof initialModel.show_watermark === 'number' ? initialModel.show_watermark : 0,
  }
  const [model, setModel]         = useState<Model>(safeModel)
  const [editModel, setEditModel] = useState<Model>(safeModel)
  const [modelUrl, setModelUrl]   = useState<string | null>(null)

  const [measureMode, setMeasureMode]   = useState<MeasureMode>('none')
  const [measureKey, setMeasureKey]     = useState(0)
  const [baseElevation, setBaseElevation] = useState(0)
  const [measureResult, setMeasureResult] = useState<string | null>(null)
  const [visualSettings, setVisualSettings] = useState<VisualSettings>(DEFAULT_VISUAL)
  const [baseMap, setBaseMap] = useState<BaseMap>('none')
  const [geopoints, setGeopoints] = useState<GeoPoint[]>([])
  const [geopointActive, setGeopointActive] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (model.external_url) { setModelUrl(model.external_url); return }
    getDownloadUrl(model.id).then(setModelUrl).catch(console.error)
  }, [model.id])

  function handleModeChange(m: MeasureMode) {
    setMeasureResult(null)
    if (m === measureMode && m !== 'none') setMeasureKey((k) => k + 1)
    else setMeasureMode(m)
  }

  async function handleSave() {
    setSaveStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    try {
      const updated = await updateModelViaToken(token, {
        longitude: editModel.longitude,
        latitude:  editModel.latitude,
        altitude:  editModel.altitude,
        heading:   editModel.heading,
        pitch:     editModel.pitch,
        roll:      editModel.roll,
        scale:     editModel.scale,
      })
      setModel(updated)
      setEditModel(updated)
      setSaveStatus('saved')
      saveTimer.current = setTimeout(() => setSaveStatus('idle'), 2500)
    } catch {
      setSaveStatus('error')
      saveTimer.current = setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  function NumField({
    label, field, step = 'any',
  }: {
    label: string
    field: keyof Pick<Model, 'longitude' | 'latitude' | 'altitude' | 'heading' | 'pitch' | 'roll' | 'scale'>
    step?: string
  }) {
    return (
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-white/40">{label}</span>
        <input
          type="number" step={step}
          value={editModel[field] as number}
          onChange={(e) => setEditModel((prev) => ({ ...prev, [field]: parseFloat(e.target.value) || 0 }))}
          className="h-7 w-full rounded-md border border-white/10 bg-white/5 px-2 text-xs text-white
                     focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </label>
    )
  }

  return (
    <div className="flex flex-col h-svh bg-background text-foreground">
      <header className="flex items-center px-4 border-b border-border shrink-0 gap-3" style={{ height: '52px' }}>
        <img src="/logo.png" alt="Quadspectat" className="h-8 w-auto shrink-0" />
        <div className="w-px h-5 bg-border mx-1 shrink-0" />
        <h1 className="text-sm font-semibold tracking-tight truncate">{model.name}</h1>
        <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
          {canEdit ? 'Editor view' : 'Read-only shared view'}
        </span>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <CesiumViewer
          selectedModel={editModel}
          modelUrl={modelUrl}
          measureMode={measureMode}
          baseElevation={baseElevation}
          measureKey={measureKey}
          onMeasureResult={setMeasureResult}
          visualSettings={visualSettings}
          baseMap={baseMap}
          geopointActive={geopointActive}
          geopoints={geopoints}
          onGeopointAdd={(pt) => setGeopoints((prev) => [...prev, pt])}
        />
        <MeasureToolbar
          mode={measureMode}
          onModeChange={handleModeChange}
          baseElevation={baseElevation}
          onBaseElevationChange={setBaseElevation}
          result={measureResult}
          geopointActive={geopointActive}
          onGeopointToggle={() => setGeopointActive((v) => !v)}
          geopoints={geopoints}
          onGeopointDelete={(id) => setGeopoints((prev) => prev.filter((p) => p.id !== id))}
          onGeopointNote={(id, note) => setGeopoints((prev) => prev.map((p) => p.id === id ? { ...p, note } : p))}
          onGeopointClear={() => { setGeopoints([]); setGeopointActive(false) }}
        />
        <VisualControls settings={visualSettings} onChange={setVisualSettings} />
        <MapSwitcher value={baseMap} onChange={setBaseMap} />

        {canEdit && (
          <div className="absolute top-3 left-4 z-20 flex flex-col items-start gap-1">
            <button
              onClick={() => setEditOpen((o) => !o)}
              className="h-8 px-3 rounded-xl text-xs font-medium
                         bg-[#080c18]/80 backdrop-blur-md border border-[#86B735]/50 text-[#a3d44a]
                         shadow-lg hover:border-[#86B735]/80 transition-all"
            >
              {editOpen ? '▲ Hide editor' : '▼ Edit position'}
            </button>

            {editOpen && (
              <div className="rounded-2xl border border-white/[0.15] bg-[#0a0e1a]/97 backdrop-blur-xl
                              shadow-2xl shadow-black/80 p-4 w-72 flex flex-col gap-3">
                <p className="text-[10px] font-semibold tracking-widest uppercase text-white/50">
                  Position &amp; Orientation
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Longitude (°)" field="longitude" />
                  <NumField label="Latitude (°)"  field="latitude" />
                  <NumField label="Altitude (m)"  field="altitude" />
                  <NumField label="Scale"         field="scale" step="0.01" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <NumField label="Heading (°)" field="heading" />
                  <NumField label="Pitch (°)"   field="pitch" />
                  <NumField label="Roll (°)"    field="roll" />
                </div>
                <button
                  onClick={() => { void handleSave() }}
                  disabled={saveStatus === 'saving'}
                  className="h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white
                             transition-colors disabled:opacity-50 flex items-center justify-center"
                >
                  {saveStatus === 'saving' ? 'Saving…' :
                   saveStatus === 'saved'  ? '✓ Saved' :
                   saveStatus === 'error'  ? 'Error — try again' : 'Save'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Orthophoto-shared view ──────────────────────────────────────────────────

function OrthoSharedView({ orthophoto }: { orthophoto: Orthophoto }) {
  const photo = orthoToResolved(orthophoto)

  const [measureMode, setMeasureMode]   = useState<MeasureMode>('none')
  const [measureKey, setMeasureKey]     = useState(0)
  const [baseElevation, setBaseElevation] = useState(0)
  const [measureResult, setMeasureResult] = useState<string | null>(null)
  const [visualSettings, setVisualSettings] = useState<VisualSettings>(DEFAULT_VISUAL)
  // Default to OSM so the orthophoto has visual context — recipient can change it.
  const [baseMap, setBaseMap] = useState<BaseMap>('osm')
  const [geopoints, setGeopoints] = useState<GeoPoint[]>([])
  const [geopointActive, setGeopointActive] = useState(false)

  const flyToOrthoRef = useRef<((p: ResolvedOrthophoto) => void) | null>(null)

  // Fly to the orthophoto once the viewer wires up its ref
  useEffect(() => {
    const t = setInterval(() => {
      if (flyToOrthoRef.current) {
        flyToOrthoRef.current(photo)
        clearInterval(t)
      }
    }, 100)
    return () => clearInterval(t)
  }, [photo.id])

  function handleModeChange(m: MeasureMode) {
    setMeasureResult(null)
    if (m === measureMode && m !== 'none') setMeasureKey((k) => k + 1)
    else setMeasureMode(m)
  }

  return (
    <div className="flex flex-col h-svh bg-background text-foreground">
      <header className="flex items-center px-4 border-b border-border shrink-0 gap-3" style={{ height: '52px' }}>
        <img src="/logo.png" alt="Quadspectat" className="h-8 w-auto shrink-0" />
        <div className="w-px h-5 bg-border mx-1 shrink-0" />
        <h1 className="text-sm font-semibold tracking-tight truncate">{photo.name}</h1>
        <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
          Shared orthophoto
        </span>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <CesiumViewer
          selectedModel={null}
          modelUrl={null}
          measureMode={measureMode}
          baseElevation={baseElevation}
          measureKey={measureKey}
          onMeasureResult={setMeasureResult}
          visualSettings={visualSettings}
          baseMap={baseMap}
          orthophotos={[photo]}
          flyToOrthoRef={flyToOrthoRef}
          geopointActive={geopointActive}
          geopoints={geopoints}
          onGeopointAdd={(pt) => setGeopoints((prev) => [...prev, pt])}
        />
        <MeasureToolbar
          mode={measureMode}
          onModeChange={handleModeChange}
          baseElevation={baseElevation}
          onBaseElevationChange={setBaseElevation}
          result={measureResult}
          geopointActive={geopointActive}
          onGeopointToggle={() => setGeopointActive((v) => !v)}
          geopoints={geopoints}
          onGeopointDelete={(id) => setGeopoints((prev) => prev.filter((p) => p.id !== id))}
          onGeopointNote={(id, note) => setGeopoints((prev) => prev.map((p) => p.id === id ? { ...p, note } : p))}
          onGeopointClear={() => { setGeopoints([]); setGeopointActive(false) }}
        />
        <VisualControls settings={visualSettings} onChange={setVisualSettings} />
        <MapSwitcher value={baseMap} onChange={setBaseMap} />
      </div>
    </div>
  )
}
