import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Model } from '@/lib/api'
import { WheelSlider } from '@/components/WheelSlider'
import type { ResolvedOrthophoto } from '@/components/OrthophotoPanel'

interface Props {
  // Models
  models: Model[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (model: Model) => void
  onDelete: (id: string) => Promise<void>
  onShare: (model: Model) => void
  // Orthophotos
  orthophotos: ResolvedOrthophoto[]
  onOrthoDelete: (id: string) => void
  onOrthoToggleVisible: (id: string) => void
  onOrthoSetOpacity: (id: string, v: number) => void
  onOrthoFlyTo: (id: string) => void
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${units[i]}`
}


export function ModelSidebar({
  models, loading, error, selectedId, onSelect, onDelete, onShare,
  orthophotos, onOrthoDelete,
  onOrthoToggleVisible, onOrthoSetOpacity, onOrthoFlyTo,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'models' | 'orthophotos'>('models')

  // Group models and orthophotos by asset_name — fall back to the item's own
  // name for legacy rows where asset_name is missing/empty
  const assetMap: Record<string, { models: Model[]; orthos: ResolvedOrthophoto[] }> = {}
  for (const m of models) {
    const key = m.asset_name?.trim() || m.name || 'Untitled'
    if (!assetMap[key]) assetMap[key] = { models: [], orthos: [] }
    assetMap[key].models.push(m)
  }
  for (const o of orthophotos) {
    const key = o.asset_name?.trim() || o.name || 'Untitled'
    if (!assetMap[key]) assetMap[key] = { models: [], orthos: [] }
    assetMap[key].orthos.push(o)
  }
  const assetNames = Object.keys(assetMap).sort()

  // Sidebar asset list
  const assetList = (
    <div className="flex-1 overflow-y-auto">
      {assetNames.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 h-32 px-4 text-center">
          <span className="text-xs text-muted-foreground">No assets yet.</span>
          <span className="text-xs text-muted-foreground/60">Upload via the Admin panel.</span>
        </div>
      )}
      {assetNames.map((an) => (
        <div
          key={an}
          className={cn(
            'flex items-center gap-2 px-3 py-2 cursor-pointer rounded transition-colors',
            selectedAsset === an ? 'bg-accent/60' : 'hover:bg-accent/30',
          )}
          onClick={() => setSelectedAsset(an)}
        >
          <span className="font-semibold text-xs truncate flex-1">{an}</span>
          <span className="text-[10px] text-muted-foreground">{assetMap[an].models.length} model{assetMap[an].models.length !== 1 ? 's' : ''}</span>
          <span className="text-[10px] text-muted-foreground">{assetMap[an].orthos.length} ortho</span>
        </div>
      ))}
    </div>
  )

  // Asset detail panel
  const assetPanel = selectedAsset && assetMap[selectedAsset] ? (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {selectedAsset}
        </span>
        <button
          onClick={() => setSelectedAsset(null)}
          className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-colors text-sm"
        >
          ✕
        </button>
      </div>
      <div className="flex border-b border-border shrink-0">
        <button
          onClick={() => setActiveTab('models')}
          className={cn(
            'flex-1 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'models'
              ? 'text-foreground border-b-2 border-primary -mb-px'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          3D Models
        </button>
        <button
          onClick={() => setActiveTab('orthophotos')}
          className={cn(
            'flex-1 py-1.5 text-xs font-medium transition-colors flex items-center justify-center gap-1',
            activeTab === 'orthophotos'
              ? 'text-foreground border-b-2 border-primary -mb-px'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Orthophotos
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'models' ? (
          assetMap[selectedAsset].models.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 h-32 px-4 text-center">
              <span className="text-xs text-muted-foreground">No models for this asset.</span>
              <span className="text-xs text-muted-foreground/60">Upload via the Admin panel.</span>
            </div>
          ) : (
            assetMap[selectedAsset].models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                selected={model.id === selectedId}
                onSelect={() => { onSelect(model); setMobileOpen(false) }}
                onShare={() => onShare(model)}
                onDelete={() => void onDelete(model.id)}
              />
            ))
          )
        ) : (
          assetMap[selectedAsset].orthos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 h-32 px-4 text-center">
              <span className="text-xs text-muted-foreground">No orthophotos for this asset.</span>
              <span className="text-xs text-muted-foreground/60">Upload via the Admin panel.</span>
            </div>
          ) : (
            assetMap[selectedAsset].orthos.map((photo) => (
              <OrthoRow
                key={photo.id}
                photo={photo}
                onToggleVisible={() => onOrthoToggleVisible(photo.id)}
                onDelete={() => onOrthoDelete(photo.id)}
                onSetOpacity={(v) => onOrthoSetOpacity(photo.id, v)}
                onFlyTo={() => onOrthoFlyTo(photo.id)}
              />
            ))
          )
        )}
      </div>
    </div>
  ) : assetList

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-background overflow-hidden">
        {assetPanel}
      </aside>

      {/* Mobile: hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden absolute top-14 left-3 z-30 h-9 flex items-center justify-center gap-1.5
                   rounded-lg border border-input bg-background/95 backdrop-blur shadow-md
                   px-3 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        style={{ position: 'fixed' }}
      >
        <span className="text-base leading-none">☰</span>
        <span className="text-xs">Assets</span>
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 flex flex-col w-72 max-w-[85vw] h-full border-r
                             border-border bg-background overflow-hidden shadow-xl">
            {assetPanel}
          </aside>
        </div>
      )}
    </>
  )
}

function ModelRow({
  model, selected, onSelect, onShare, onDelete,
}: {
  model: Model
  selected: boolean
  onSelect: () => void
  onShare: () => void
  onDelete: () => void
}) {
  const typeLabel = model.model_type === '3d-tiles' ? '3D Tiles'
    : model.model_type === 'pointcloud' ? 'Point Cloud'
    : model.file_type === 'model/gltf-binary' ? 'GLB'
    : model.file_type === 'model/gltf+json' ? 'GLTF'
    : null

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group relative flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors',
        'hover:bg-accent/60',
        selected
          ? 'bg-accent border-l-2 border-l-primary'
          : 'border-l-2 border-l-transparent',
      )}
    >
      {/* Icon */}
      <div className={cn(
        'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold',
        selected
          ? 'bg-primary/20 text-primary'
          : 'bg-muted text-muted-foreground',
      )}>
        {model.model_type === '3d-tiles' ? '3D' : model.model_type === 'pointcloud' ? 'PC' : '3D'}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <span className={cn(
          'block text-sm font-medium truncate leading-tight',
          selected ? 'text-foreground' : 'text-foreground/80',
        )}>
          {model.name}
        </span>
        <span className="block text-[11px] text-muted-foreground mt-0.5">
          {typeLabel ?? 'Model'}{model.file_size ? ` · ${formatBytes(model.file_size)}` : ''}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onShare() }}
          title="Share"
          className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground
                     hover:text-primary hover:bg-primary/10 transition-all text-xs"
        >
          ↗
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          title="Delete"
          className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground
                     hover:text-destructive hover:bg-destructive/10 transition-all text-xs"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function OrthoRow({
  photo, onToggleVisible, onDelete, onSetOpacity, onFlyTo,
}: {
  photo: ResolvedOrthophoto
  onToggleVisible: () => void
  onDelete: () => void
  onSetOpacity: (v: number) => void
  onFlyTo: () => void
}) {
  const canFlyTo = photo.status === 'ready' && photo.bounds_west != null

  return (
    <div className="border-b border-border">
      {/* Main row */}
      <div className="group flex items-center gap-2 px-3 py-2.5 hover:bg-accent/40 transition-colors">
        {/* Status / visibility toggle */}
        {photo.status === 'ready' ? (
          <button
            onClick={onToggleVisible}
            title={photo.visible ? 'Hide' : 'Show'}
            className={cn(
              'shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors',
              photo.visible
                ? 'text-primary hover:bg-primary/10'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {photo.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        ) : photo.status === 'error' ? (
          <span className="shrink-0 w-7 h-7 flex items-center justify-center text-destructive">
            <AlertCircle size={14} />
          </span>
        ) : (
          <span className="shrink-0 w-7 h-7 flex items-center justify-center text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
          </span>
        )}

        {/* Name + status */}
        <div
          className={cn('flex-1 min-w-0', canFlyTo && 'cursor-pointer')}
          onClick={canFlyTo ? onFlyTo : undefined}
          title={canFlyTo ? 'Fly to location' : undefined}
        >
          <span className={cn(
            'block text-sm truncate leading-tight',
            photo.status === 'ready' && photo.visible ? 'text-foreground' :
            photo.status === 'error' ? 'text-destructive/80' :
            photo.status === 'ready' ? 'text-muted-foreground line-through' :
            'text-muted-foreground',
          )}>
            {photo.name}
          </span>
          <span className="block text-[11px] text-muted-foreground mt-0.5">
            {photo.status === 'error'
              ? (photo.error_message ?? 'Processing failed')
              : photo.status === 'processing' ? 'Processing…'
              : photo.status === 'ready' ? 'Orthophoto'
              : 'Queued…'}
          </span>
        </div>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md
                     text-muted-foreground hover:text-destructive hover:bg-destructive/10
                     transition-all opacity-0 group-hover:opacity-100"
        >
          <X size={12} />
        </button>
      </div>

      {/* Opacity slider (only when ready) */}
      {photo.status === 'ready' && (
        <div className="px-3 pb-2.5 flex items-center gap-2 bg-muted/20">
          <span className="text-[10px] text-muted-foreground w-12 shrink-0">Opacity</span>
          <div className="relative flex-1 h-4 flex items-center">
            <div className="absolute inset-x-0 h-[3px] rounded-full bg-border" />
            <div
              className="absolute left-0 h-[3px] rounded-full bg-primary/70"
              style={{ width: `${photo.opacity * 100}%` }}
            />
            <div
              className="absolute w-3 h-3 rounded-full bg-background border-2 border-primary pointer-events-none"
              style={{ left: `calc(${photo.opacity * 100}% - 6px)` }}
            />
            <WheelSlider
              min={0} max={1} step={0.01}
              value={photo.opacity}
              onChange={onSetOpacity}
              className="absolute inset-x-0 opacity-0 h-4 w-full cursor-pointer"
            />
          </div>
          <span className="text-[11px] font-mono text-muted-foreground w-8 text-right shrink-0">
            {Math.round(photo.opacity * 100)}%
          </span>
        </div>
      )}
    </div>
  )
}
