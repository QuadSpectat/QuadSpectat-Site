import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CesiumViewer } from '@/components/CesiumViewer'
import { ModelSidebar } from '@/components/ModelSidebar'
import { MeasureToolbar } from '@/components/MeasureToolbar'
import { UploadDialog } from '@/components/UploadDialog'
import { ShareDialog } from '@/components/ShareDialog'
import { LayerPanel } from '@/components/LayerPanel'
import { OrthophotoPanel } from '@/components/OrthophotoPanel'
import { VisualControls } from '@/components/VisualControls'
import { MapSwitcher } from '@/components/MapSwitcher'
import { useModels } from '@/hooks/useModels'
import { getDownloadUrl, updateModel } from '@/lib/api'
import { DEFAULT_VISUAL } from '@/lib/visualControls'
import type { Model } from '@/lib/api'
import type { MeasureMode } from '@/lib/measure'
import type { VisualSettings } from '@/lib/visualControls'
import type { BaseMap } from '@/components/MapSwitcher'
import type { ResolvedLayer } from '@/components/LayerPanel'
import type { ResolvedOrthophoto } from '@/components/OrthophotoPanel'

export default function App() {
  const { models, loading, error, refresh, remove } = useModels()
  const navigate = useNavigate()

  const [selectedModel, setSelectedModel] = useState<Model | null>(null)
  const [modelUrl, setModelUrl]           = useState<string | null>(null)
  const [showUpload, setShowUpload]       = useState(false)
  const [shareModel, setShareModel]       = useState<Model | null>(null)

  const [measureMode, setMeasureMode]           = useState<MeasureMode>('none')
  const [measureKey, setMeasureKey]             = useState(0)
  const [baseElevation, setBaseElevation]       = useState(0)
  const [measureResult, setMeasureResult]       = useState<string | null>(null)
  const [visualSettings, setVisualSettings]     = useState<VisualSettings>(DEFAULT_VISUAL)
  const [baseMap, setBaseMap]                   = useState<BaseMap>('none')
  const [layers, setLayers]                     = useState<ResolvedLayer[]>([])
  const [orthophotos, setOrthophotos]           = useState<ResolvedOrthophoto[]>([])

  // Snap-to-ground: CesiumViewer writes its snap function here; VisualControls button calls it
  const snapRef = useRef<(() => void) | null>(null)

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

  async function handleDelete(id: string) {
    await remove(id)
    if (selectedModel?.id === id) setSelectedModel(null)
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
    <div className="flex flex-col h-screen bg-background text-foreground">
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
          onUploadClick={() => setShowUpload(true)}
        />

        {/* Viewer + floating toolbar share this relative container */}
        <div className="relative flex-1 overflow-hidden">
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
            orthophotos={orthophotos}
            onSnapToGround={(offset) => void handleSnapToGround(offset)}
            snapRef={snapRef}
          />
          <MeasureToolbar
            mode={measureMode}
            onModeChange={handleModeChange}
            baseElevation={baseElevation}
            onBaseElevationChange={setBaseElevation}
            result={measureResult}
          />
          <VisualControls
            settings={visualSettings}
            onChange={setVisualSettings}
            onSnapToGround={selectedModel?.model_type === '3d-tiles' ? () => snapRef.current?.() : undefined}
            crsLabel={crsLabel()}
          />
          <MapSwitcher value={baseMap} onChange={setBaseMap} />
          {/* Bottom-right overlay controls: OrthophotoPanel + LayerPanel side-by-side */}
          <div className="absolute bottom-14 right-4 z-20 flex flex-row-reverse items-end gap-2">
            {selectedModel && (
              <LayerPanel modelId={selectedModel.id} onLayersChange={setLayers} />
            )}
            <OrthophotoPanel onOrthophotosChange={setOrthophotos} />
          </div>
          {/* Stamp */}
          <div
            className="absolute bottom-2 left-2 z-10 pointer-events-none select-none"
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
              אא מערכות מידה וניהול משאבים בע&quot;מ
            </span>
          </div>
        </div>
      </div>

      {showUpload && (
        <UploadDialog
          onClose={() => setShowUpload(false)}
          onSuccess={() => { setShowUpload(false); void refresh() }}
        />
      )}

      {shareModel && (
        <ShareDialog
          modelId={shareModel.id}
          modelName={shareModel.name}
          onClose={() => setShareModel(null)}
        />
      )}
    </div>
  )
}
