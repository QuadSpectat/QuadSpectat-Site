import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CesiumViewer } from '@/components/CesiumViewer'
import { ModelSidebar } from '@/components/ModelSidebar'
import { MeasureToolbar } from '@/components/MeasureToolbar'
import { ShareDialog } from '@/components/ShareDialog'
import { LayerPanel } from '@/components/LayerPanel'
import { ComparePanel } from '@/components/ComparePanel'
import { VisualControls } from '@/components/VisualControls'
import { MapSwitcher } from '@/components/MapSwitcher'
import { useModels } from '@/hooks/useModels'
import { getDownloadUrl, updateModel, listOrthophotos, deleteOrthophoto } from '@/lib/api'
import type { GeoPoint } from '@/lib/geopoints'
import { DEFAULT_VISUAL } from '@/lib/visualControls'
import type { Model, Orthophoto } from '@/lib/api'
import type { MeasureMode } from '@/lib/measure'
import type { VisualSettings } from '@/lib/visualControls'
import type { BaseMap } from '@/components/MapSwitcher'
import type { ResolvedLayer } from '@/components/LayerPanel'
import type { ResolvedOrthophoto } from '@/components/OrthophotoPanel'
import type { OrthoCompare } from '@/components/ComparePanel'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

function toOrthoState(o: Orthophoto): ResolvedOrthophoto {
  return {
    id:           o.id,
    asset_name:   o.asset_name?.trim() || o.name,   // fallback for legacy rows
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

export default function App() {
  const { models, loading, error, refresh, remove } = useModels()
  const navigate = useNavigate()

  const [selectedModel, setSelectedModel] = useState<Model | null>(null)
  const [modelUrl, setModelUrl]           = useState<string | null>(null)
  const [shareModel, setShareModel]       = useState<Model | null>(null)
  const [shareOrtho, setShareOrtho]       = useState<ResolvedOrthophoto | null>(null)

  const [measureMode, setMeasureMode]           = useState<MeasureMode>('none')
  const [measureKey, setMeasureKey]             = useState(0)
  const [baseElevation, setBaseElevation]       = useState(0)
  const [measureResult, setMeasureResult]       = useState<string | null>(null)
  const [visualSettings, setVisualSettings]     = useState<VisualSettings>(DEFAULT_VISUAL)
  const [baseMap, setBaseMap]                   = useState<BaseMap>('none')
  const [layers, setLayers]                     = useState<ResolvedLayer[]>([])
  const [orthoPhotos, setOrthoPhotos]           = useState<ResolvedOrthophoto[]>([])
  const [overlayModel, setOverlayModel]         = useState<Model | null>(null)
  const [overlayModelUrl, setOverlayModelUrl]   = useState<string | null>(null)
  const [compareBlend, setCompareBlend]         = useState(0.5)
  const [orthoCompare, setOrthoCompare]         = useState<OrthoCompare | null>(null)

  const [geopoints, setGeopoints]           = useState<GeoPoint[]>([])
  const [geopointActive, setGeopointActive] = useState(false)

  // Snap-to-ground ref, reset-camera ref, fly-to-ortho ref
  const snapRef        = useRef<(() => void) | null>(null)
  const resetCameraRef = useRef<(() => void) | null>(null)
  const flyToOrthoRef  = useRef<((photo: ResolvedOrthophoto) => void) | null>(null)

  // Load orthophotos on mount
  useEffect(() => {
    listOrthophotos().then((list) => setOrthoPhotos(list.map(toOrthoState))).catch(console.error)
  }, [])

  // Poll while any orthophoto is still processing
  useEffect(() => {
    const needsPoll = orthoPhotos.some((p) => p.status === 'pending' || p.status === 'processing')
    if (!needsPoll) return
    const timer = setInterval(async () => {
      const fresh = await listOrthophotos().catch(() => null)
      if (!fresh) return
      setOrthoPhotos((prev) => prev.map((p) => {
        const updated = fresh.find((f) => f.id === p.id)
        if (!updated) return p
        return { ...p, status: updated.status, error_message: updated.error_message,
          bounds_west: updated.bounds_west, bounds_south: updated.bounds_south,
          bounds_east: updated.bounds_east, bounds_north: updated.bounds_north,
          zoom_min: updated.zoom_min ?? p.zoom_min, zoom_max: updated.zoom_max ?? p.zoom_max }
      }))
    }, 3000)
    return () => clearInterval(timer)
  }, [orthoPhotos.map((p) => p.status).join(',')])

  // Reset fine-tune slider to 0 when selecting a different model (CRS base offset handles it)
  useEffect(() => {
    setVisualSettings((s) => ({ ...s, heightOffset: 0 }))
  }, [selectedModel?.id])

  useEffect(() => {
    if (!selectedModel) { setModelUrl(null); return }
    if (selectedModel.external_url) { setModelUrl(selectedModel.external_url); return }
    let cancelled = false
    getDownloadUrl(selectedModel.id)
      .then((url) => { if (!cancelled) setModelUrl(url) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [selectedModel?.id])

  // Resolve overlay model download URL (same pattern as main model)
  useEffect(() => {
    if (!overlayModel) { setOverlayModelUrl(null); return }
    if (overlayModel.external_url) { setOverlayModelUrl(overlayModel.external_url); return }
    let cancelled = false
    getDownloadUrl(overlayModel.id)
      .then((url) => { if (!cancelled) setOverlayModelUrl(url) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [overlayModel?.id])

  async function handleDelete(id: string) {
    await remove(id)
    if (selectedModel?.id === id) setSelectedModel(null)
  }

  async function handleOrthoDelete(id: string) {
    await deleteOrthophoto(id)
    setOrthoPhotos((prev) => prev.filter((p) => p.id !== id))
  }

  function handleOrthoToggleVisible(id: string) {
    setOrthoPhotos((prev) => prev.map((p) => p.id === id ? { ...p, visible: !p.visible } : p))
  }

  function handleOrthoSetOpacity(id: string, opacity: number) {
    setOrthoPhotos((prev) => prev.map((p) => p.id === id ? { ...p, opacity } : p))
  }

  function handleModeChange(m: MeasureMode) {
    setMeasureResult(null)
    if (m === measureMode && m !== 'none') {
      setMeasureKey((k) => k + 1)
    } else {
      setMeasureMode(m)
    }
  }

  async function handleSnapToGround(detectedOffset: number) {
    // Apply offset immediately for instant visual feedback
    setVisualSettings((s) => ({ ...s, heightOffset: 0 }))
    if (!selectedModel) return
    // Persist to DB so it auto-corrects on next load
    const updated = await updateModel(selectedModel.id, {
      coordinate_system: 'custom',
      geoid_offset: detectedOffset,
    }).catch(console.error)
    if (updated) {
      setSelectedModel(updated)
      // Update in models list too
      void refresh()
    }
  }

  function crsLabel(): string | undefined {
    if (!selectedModel) return undefined
    const { coordinate_system, geoid_offset } = selectedModel
    if (coordinate_system === 'unknown' || coordinate_system === 'wgs84') return undefined
    const sign = geoid_offset >= 0 ? '+' : ''
    return `${coordinate_system.toUpperCase()} ${sign}${geoid_offset.toFixed(1)} m`
  }

  return (
    <div className="flex flex-col h-svh bg-background text-foreground">
      <header className="flex items-center px-4 h-13 border-b border-border shrink-0 gap-3" style={{ height: '52px' }}>
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
          title="Back to home"
        >
          <img src="/logo.png" alt="Quadspectat" className="h-8 w-auto" />
        </button>
        <div className="w-px h-5 bg-border mx-1 shrink-0" />
        <span className="text-xs font-semibold tracking-tight text-muted-foreground">3D Viewer</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <ModelSidebar
          models={models}
          loading={loading}
          error={error}
          selectedId={selectedModel?.id ?? null}
          onSelect={setSelectedModel}
          onDelete={handleDelete}
          onShare={setShareModel}
          orthophotos={orthoPhotos}
          onOrthoDelete={(id) => void handleOrthoDelete(id)}
          onOrthoToggleVisible={handleOrthoToggleVisible}
          onOrthoSetOpacity={handleOrthoSetOpacity}
          onOrthoFlyTo={(id) => {
            const photo = orthoPhotos.find((p) => p.id === id)
            if (photo) flyToOrthoRef.current?.(photo)
          }}
          onOrthoShare={setShareOrtho}
        />

        {/* Viewer + floating toolbar share this relative container */}
        <div className={`relative flex-1 overflow-hidden${geopointActive ? ' cursor-crosshair' : ''}`}>
          <CesiumViewer
            selectedModel={selectedModel}
            modelUrl={modelUrl}
            measureMode={measureMode}
            baseElevation={baseElevation}
            measureKey={measureKey}
            onMeasureResult={setMeasureResult}
            visualSettings={visualSettings}
            baseMap={baseMap}
            layers={layers}
            orthophotos={orthoPhotos}
            overlayModel={overlayModel}
            overlayModelUrl={overlayModelUrl}
            compareBlend={compareBlend}
            orthoCompare={orthoCompare}
            onSnapToGround={(offset) => void handleSnapToGround(offset)}
            snapRef={snapRef}
            resetCameraRef={resetCameraRef}
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
            onResetCamera={selectedModel ? () => resetCameraRef.current?.() : undefined}
            geopointActive={geopointActive}
            onGeopointToggle={() => setGeopointActive((v) => !v)}
            geopoints={geopoints}
            onGeopointDelete={(id) => setGeopoints((prev) => prev.filter((p) => p.id !== id))}
            onGeopointNote={(id, note) => setGeopoints((prev) => prev.map((p) => p.id === id ? { ...p, note } : p))}
            onGeopointClear={() => { setGeopoints([]); setGeopointActive(false) }}
          />
          <VisualControls
            settings={visualSettings}
            onChange={setVisualSettings}
            onSnapToGround={selectedModel?.model_type === '3d-tiles' ? () => snapRef.current?.() : undefined}
            crsLabel={crsLabel()}
          />
          <MapSwitcher value={baseMap} onChange={setBaseMap} />
          {/* Bottom-right overlay controls: LayerPanel + ComparePanel */}
          <div className="absolute bottom-14 right-4 z-20 flex flex-row-reverse items-end gap-2">
            {selectedModel && (
              <LayerPanel modelId={selectedModel.id} onLayersChange={setLayers} />
            )}
            <ComparePanel
              models={models}
              selectedModel={selectedModel}
              orthophotos={orthoPhotos}
              overlayModel={overlayModel}
              compareBlend={compareBlend}
              orthoCompare={orthoCompare}
              onOverlayModelChange={setOverlayModel}
              onCompareBlendChange={setCompareBlend}
              onOrthoCompareChange={setOrthoCompare}
            />
          </div>
          {/* Stamp — hidden when show_watermark=0 or watermark_text is empty */}
          {(selectedModel?.show_watermark ?? 1) !== 0 && selectedModel?.watermark_text && (
            <div
              className="absolute bottom-2 left-4 z-30 pointer-events-none select-none"
              style={{ direction: 'rtl' }}
            >
              <span
                className="text-[10px] font-medium tracking-wide px-2 py-0.5 rounded"
                style={{
                  background: 'rgba(0,0,0,0.35)',
                  color: 'rgba(255,255,255,0.55)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                {selectedModel.watermark_text}
              </span>
            </div>
          )}
        </div>
      </div>

      {shareModel && (
        <ShareDialog
          target={{ kind: 'model', id: shareModel.id, name: shareModel.name }}
          onClose={() => setShareModel(null)}
        />
      )}
      {shareOrtho && (
        <ShareDialog
          target={{ kind: 'orthophoto', id: shareOrtho.id, name: shareOrtho.name }}
          onClose={() => setShareOrtho(null)}
        />
      )}
    </div>
  )
}
