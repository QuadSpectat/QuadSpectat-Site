import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { Model } from '@/lib/api'

interface Props {
  models: Model[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (model: Model) => void
  onDelete: (id: string) => Promise<void>
  onShare: (model: Model) => void
  onUploadClick: () => void
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
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const content = (
    <>
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Models
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onUploadClick}
            title="Upload model"
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent
                       text-muted-foreground hover:text-foreground transition-colors text-base leading-none"
          >
            +
          </button>
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

      {/* List area */}
      <div className="flex-1 overflow-y-auto">
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
      </div>
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
        className="md:hidden absolute top-14 left-3 z-30 h-9 w-9 flex items-center justify-center
                   rounded-md border border-input bg-background/90 backdrop-blur shadow
                   text-muted-foreground hover:text-foreground transition-colors"
        style={{ position: 'fixed' }}
      >
        ☰
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
