import { useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { resolveShareToken, getDownloadUrl } from '@/lib/api'
import type { Model } from '@/lib/api'
import { CesiumViewer } from '@/components/CesiumViewer'
import { MeasureToolbar } from '@/components/MeasureToolbar'
import { VisualControls } from '@/components/VisualControls'
import { MapSwitcher } from '@/components/MapSwitcher'
import { DEFAULT_VISUAL } from '@/lib/visualControls'
import type { MeasureMode } from '@/lib/measure'
import type { VisualSettings } from '@/lib/visualControls'
import type { BaseMap } from '@/components/MapSwitcher'

export function SharedViewer() {
  const { token } = useParams<{ token: string }>()
  const [model, setModel] = useState<Model | null>(null)
  const [modelUrl, setModelUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [measureMode, setMeasureMode] = useState<MeasureMode>('none')
  const [measureKey, setMeasureKey] = useState(0)
  const [baseElevation, setBaseElevation] = useState(0)
  const [measureResult, setMeasureResult] = useState<string | null>(null)
  const [visualSettings, setVisualSettings] = useState<VisualSettings>(DEFAULT_VISUAL)
  const [baseMap, setBaseMap] = useState<BaseMap>('none')

  // Resolve token → model
  useEffect(() => {
    if (!token) { setErr('Invalid link'); return }
    resolveShareToken(token)
      .then(setModel)
      .catch(() => setErr('This link is invalid or has been removed.'))
  }, [token])

  // Resolve model URL
  useEffect(() => {
    if (!model) { setModelUrl(null); return }
    if (model.external_url) { setModelUrl(model.external_url); return }
    getDownloadUrl(model.id)
      .then(setModelUrl)
      .catch(console.error)
  }, [model?.id])

  if (err) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <div className="text-center max-w-sm">
          <p className="text-sm text-muted-foreground">{err}</p>
        </div>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    )
  }

  function handleModeChange(m: MeasureMode) {
    setMeasureResult(null)
    if (m === measureMode && m !== 'none') setMeasureKey((k) => k + 1)
    else setMeasureMode(m)
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center px-4 border-b border-border shrink-0 gap-3" style={{ height: '52px' }}>
        <img src="/logo.png" alt="Quadspectat" className="h-8 w-auto shrink-0" />
        <div className="w-px h-5 bg-border mx-1 shrink-0" />
        <h1 className="text-sm font-semibold tracking-tight truncate">{model.name}</h1>
        <span className="text-[11px] text-muted-foreground ml-auto shrink-0">Read-only shared view</span>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <CesiumViewer
          selectedModel={model}
          modelUrl={modelUrl}
          measureMode={measureMode}
          baseElevation={baseElevation}
          measureKey={measureKey}
          onMeasureResult={setMeasureResult}
          visualSettings={visualSettings}
          baseMap={baseMap}
        />
        <MeasureToolbar
          mode={measureMode}
          onModeChange={handleModeChange}
          baseElevation={baseElevation}
          onBaseElevationChange={setBaseElevation}
          result={measureResult}
        />
        <VisualControls settings={visualSettings} onChange={setVisualSettings} />
        <MapSwitcher value={baseMap} onChange={setBaseMap} />
        {/* Stamp */}
        <div className="absolute bottom-2 left-2 z-10 pointer-events-none select-none" style={{ direction: 'rtl' }}>
          <span
            className="text-[10px] font-medium tracking-wide px-2 py-0.5 rounded"
            style={{ background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(4px)' }}
          >
            אא מערכות מידה וניהול משאבים בע&quot;מ
          </span>
        </div>
      </div>
    </div>
  )
}
