import { useState, useRef } from 'react'
import { Eye, EyeOff, Loader2, AlertCircle, X, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Model } from '@/lib/api'
import { WheelSlider } from '@/components/WheelSlider'
import type { ResolvedOrthophoto } from '@/components/OrthophotoPanel'

const ACCEPTED_ORTHO = '.tif,.tiff,.ecw,.jp2,.j2k,.sid'

interface Props {
  // Models
  models: Model[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (model: Model) => void
  onDelete: (id: string) => Promise<void>
  onShare: (model: Model) => void
  onUploadClick: () => void
  // Orthophotos
  orthophotos: ResolvedOrthophoto[]
  orthoUploading: boolean
  orthoUploadError: string | null
  onOrthoFile: (file: File) => void
  onOrthoDelete: (id: string) => void
  onOrthoToggleVisible: (id: string) => void
  onOrthoSetOpacity: (id: string, v: number) => void
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
  models, loading, error, selectedId, onSelect, onDelete, onShare, onUploadClick,
  orthophotos, orthoUploading, orthoUploadError, onOrthoFile, onOrthoDelete,
  onOrthoToggleVisible, onOrthoSetOpacity,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'models' | 'orthophotos'>('models')
  const orthoFileRef = useRef<HTMLInputElement>(null)

  const readyOrthos = orthophotos.filter((p) => p.status === 'ready').length

  const modelsContent = (
    <>
      {loading && (
        <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">
          Loading…
        </div>
      )}
      {!loading && error && (
        <div className="p-3 text-xs text-destructive">{error}</div>
      )}
      {!loading && !error && models.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 h-32 px-4 text-center">
          <span className="text-xs text-muted-foreground">No models yet.</span>
          <button onClick={onUploadClick} className="text-xs text-primary hover:underline">
            Upload your first model
          </button>
        </div>
      )}
      {models.map((model) => (
        <ModelRow
          key={model.id}
          model={model}
          selected={model.id === selectedId}
          onSelect={() => { onSelect(model); setMobileOpen(false) }}
          onShare={() => onShare(model)}
          onDelete={() => void onDelete(model.id)}
        />
      ))}
    </>
  )

  const orthosContent = (
    <>
      {orthoUploadError && (
        <div className="px-3 py-2 text-[11px] text-destructive border-b border-border">
          {orthoUploadError}
        </div>
      )}
      {orthophotos.length === 0 && !orthoUploading && (
        <div className="flex flex-col items-center justify-center gap-2 h-32 px-4 text-center">
          <span className="text-xs text-muted-foreground">No orthophotos yet.</span>
          <button
            onClick={() => orthoFileRef.current?.click()}
            className="text-xs text-primary hover:underline"
          >
            Upload a GeoTIFF / ECW / JP2
          </button>
        </div>
      )}
      {orthophotos.map((photo) => (
        <OrthoRow
          key={photo.id}
          photo={photo}
          onToggleVisible={() => onOrthoToggleVisible(photo.id)}
          onDelete={() => onOrthoDelete(photo.id)}
          onSetOpacity={(v) => onOrthoSetOpacity(photo.id, v)}
        />
      ))}
    </>
  )

  const content = (
    <>
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Assets
        </span>
        <div className="flex items-center gap-1">
          {activeTab === 'models' ? (
            <button
              onClick={onUploadClick}
              title="Upload model"
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent
                         text-muted-foreground hover:text-foreground transition-colors text-base leading-none"
            >
              +
            </button>
          ) : (
            <button
              onClick={() => orthoFileRef.current?.click()}
              disabled={orthoUploading}
              title="Upload orthophoto"
              className="h-7 flex items-center gap-1 px-2 rounded hover:bg-accent
                         text-muted-foreground hover:text-foreground transition-colors text-xs disabled:opacity-40"
            >
              <Upload size={11} />
              {orthoUploading ? 'Uploading…' : 'Upload'}
            </button>
          )}
          {/* Close button — mobile only */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden h-7 w-7 flex items-center justify-center rounded hover:bg-accent
                       text-muted-foreground transition-colors text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
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
          {readyOrthos > 0 && (
            <span className="bg-primary/20 text-primary rounded-full px-1.5 text-[10px] font-semibold">
              {readyOrthos}
            </span>
          )}
        </button>
      </div>

      {/* List area */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'models' ? modelsContent : orthosContent}
      </div>

      <input
        ref={orthoFileRef}
        type="file"
        accept={ACCEPTED_ORTHO}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onOrthoFile(f) }}
      />
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-background overflow-hidden">
        {content}
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
            {content}
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
  photo, onToggleVisible, onDelete, onSetOpacity,
}: {
  photo: ResolvedOrthophoto
  onToggleVisible: () => void
  onDelete: () => void
  onSetOpacity: (v: number) => void
}) {
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
        <div className="flex-1 min-w-0">
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
