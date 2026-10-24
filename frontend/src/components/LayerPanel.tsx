import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Layers, Eye, EyeOff, Upload, X, ChevronUp, ChevronDown, ChevronsUpDown, RotateCcw, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  listLayers, deleteLayer, getLayerDownloadUrl, uploadLayer, patchLayer, recheckLayer, getLayerLimits, getAuthHeader,
} from '@/lib/api'
import type { Layer, LayerPatch, ClampMode, LayerSourceCrs, LayerLimits } from '@/lib/api'
import { WheelSlider } from '@/components/WheelSlider'

/** What the 3D viewer needs to draw one layer. */
export interface ResolvedLayer {
  id: string
  name: string
  url: string
  fileType: string
  visible: boolean
  heightOffset: number
  clampMode: ClampMode
  /** Changes when the owner presses Retry, so the viewer reloads the file */
  reloadKey: number
  sourceCrs?: string | null
}

export type LayerLoadState = { state: 'loading' | 'ok' | 'error'; message?: string }

export interface LayerItem {
  id: string
  name: string
  fileType: string
  visible: boolean
  clientVisible: boolean
  heightOffset: number
  clampMode: ClampMode
  hasZ: boolean
  sortOrder: number
  status: 'ready' | 'error'
  statusMessage: string | null
  sourceCrs: string | null
  featureCount: number | null
  byteSize: number | null
  load: LayerLoadState
}

const FALLBACK_LIMITS: LayerLimits = { maxBytes: 25 * 1024 * 1024, warnFeatures: 5000, maxFeatures: 50000, extensions: ['geojson', 'json', 'kml', 'kmz', 'czml'], sourceCrs: ['EPSG:4326', 'EPSG:2039'] }

function normalize(l: Layer): LayerItem {
  return {
    id: l.id,
    name: l.name,
    fileType: l.file_type,
    visible: l.visible !== 0,
    clientVisible: l.client_visible === 1,
    heightOffset: l.height_offset ?? 0,
    // 'none' = saved before clamp modes existed: the file's own heights, exactly as before
    clampMode: l.clamp_mode === 'drape' ? 'drape' : 'heights',
    hasZ: l.has_z === 1,
    sortOrder: l.sort_order ?? 0,
    status: l.status === 'error' ? 'error' : 'ready',
    statusMessage: l.status_message ?? null,
    sourceCrs: l.source_crs ?? null,
    featureCount: l.feature_count ?? null,
    byteSize: l.byte_size ?? null,
    load: { state: 'loading' },
  }
}

export const isOwnerSession = (): boolean => !!getAuthHeader().Authorization

export interface UploadFailure { message: string; file: File; crs: LayerSourceCrs }

export interface LayersCtl {
  items: LayerItem[]
  resolved: ResolvedLayer[]
  canEdit: boolean
  uploading: boolean
  uploadFailure: UploadFailure | null
  dismissUploadFailure: () => void
  notice: string | null
  limits: LayerLimits
  upload: (file: File, crs: LayerSourceCrs) => Promise<boolean>
  update: (id: string, patch: LayerPatch) => void
  remove: (id: string) => Promise<void>
  retry: (id: string) => Promise<void>
  move: (id: string, dir: -1 | 1) => void
  onLoadState: (id: string, st: LayerLoadState) => void
}

const SAVE_DELAY_MS = 600

/**
 * The layers of one model: list, upload, and the per-layer state (visibility, clamp mode, offset, order, client flag).
 * Changes apply at once and are saved to the server shortly after (debounced) for the owner; share links get a
 * read-only copy and never write.
 */
export function useLayers(modelId: string | null, opts: { shareToken?: string; canEdit: boolean }): LayersCtl {
  const { shareToken, canEdit } = opts
  const [items, setItems] = useState<LayerItem[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [reload, setReload] = useState<Record<string, number>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadFailure, setUploadFailure] = useState<UploadFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [limits, setLimits] = useState<LayerLimits>(FALLBACK_LIMITS)
  const pending = useRef(new Map<string, { patch: LayerPatch; timer: ReturnType<typeof setTimeout> }>())
  const itemsRef = useRef<LayerItem[]>([])
  itemsRef.current = items

  const flush = useCallback((id?: string) => {
    for (const [pid, p] of [...pending.current]) {
      if (id && pid !== id) continue
      clearTimeout(p.timer)
      pending.current.delete(pid)
      patchLayer(pid, p.patch).catch((e: Error) => setNotice(`Could not save layer settings: ${e.message}`))
    }
  }, [])

  const resolveUrl = useCallback(async (id: string, live: () => boolean) => {
    try {
      const url = await getLayerDownloadUrl(id, shareToken)
      if (live()) setUrls((u) => ({ ...u, [id]: url }))
    } catch (e) {
      if (live()) setItems((ls) => ls.map((l) => l.id === id ? { ...l, load: { state: 'error', message: `Could not get the file link (${(e as Error).message})` } } : l))
    }
  }, [shareToken])

  // Load the model's layers; resolve download links only for layers that are usable
  useEffect(() => {
    let alive = true
    setItems([]); setUrls({}); setReload({}); setNotice(null); setUploadFailure(null)
    if (!modelId) return
    listLayers(modelId, shareToken)
      .then((ls) => {
        if (!alive) return
        const list = ls.map(normalize).sort((a, b) => a.sortOrder - b.sortOrder)
        setItems(list)
        list.filter((l) => l.status !== 'error').forEach((l) => void resolveUrl(l.id, () => alive))
      })
      .catch((e: Error) => { if (alive) setNotice(`Could not load layers: ${e.message}`); console.error(e) })
    return () => { alive = false }
  }, [modelId, shareToken, resolveUrl])

  useEffect(() => {
    if (!canEdit) return
    getLayerLimits().then(setLimits).catch(() => { /* fallback numbers are only for the hint text */ })
  }, [canEdit])

  // Save anything still waiting when the panel goes away
  useEffect(() => () => flush(), [flush])

  const update = useCallback((id: string, patch: LayerPatch) => {
    setItems((ls) => ls.map((l) => {
      if (l.id !== id) return l
      const n = { ...l }
      if (patch.visible !== undefined) n.visible = patch.visible
      if (patch.client_visible !== undefined) n.clientVisible = patch.client_visible
      if (patch.height_offset !== undefined) n.heightOffset = patch.height_offset
      if (patch.clamp_mode !== undefined) n.clampMode = patch.clamp_mode
      if (patch.sort_order !== undefined) n.sortOrder = patch.sort_order
      if (patch.name !== undefined) n.name = patch.name
      return n
    }))
    if (!canEdit) return
    const cur = pending.current.get(id)
    if (cur) clearTimeout(cur.timer)
    const merged = { ...(cur?.patch ?? {}), ...patch }
    pending.current.set(id, { patch: merged, timer: setTimeout(() => flush(id), SAVE_DELAY_MS) })
  }, [canEdit, flush])

  const upload = useCallback(async (file: File, crs: LayerSourceCrs): Promise<boolean> => {
    if (!modelId) return false
    setUploading(true)
    setUploadFailure(null)
    try {
      const layer = await uploadLayer(file, modelId, crs)
      const item = normalize(layer)
      item.sortOrder = layer.sort_order ?? itemsRef.current.length
      setItems((ls) => [...ls.filter((l) => l.id !== item.id), item])
      void resolveUrl(item.id, () => true)
      return true
    } catch (e) {
      setUploadFailure({ message: e instanceof Error ? e.message : 'Upload failed', file, crs })
      return false
    } finally {
      setUploading(false)
    }
  }, [modelId, resolveUrl])

  const remove = useCallback(async (id: string) => {
    try {
      await deleteLayer(id)
      const p = pending.current.get(id)
      if (p) { clearTimeout(p.timer); pending.current.delete(id) }
      setItems((ls) => ls.filter((l) => l.id !== id))
      setUrls(({ [id]: _gone, ...rest }) => rest)
    } catch (e) {
      setNotice(`Could not delete the layer: ${(e as Error).message}`)
    }
  }, [])

  const retry = useCallback(async (id: string) => {
    try {
      flush(id)
      const row = await recheckLayer(id)
      const fresh = normalize(row)
      setItems((ls) => ls.map((l) => l.id === id ? { ...fresh, visible: l.visible, clientVisible: l.clientVisible, load: { state: 'loading' } } : l))
      if (fresh.status !== 'error') {
        await resolveUrl(id, () => true)
        setReload((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }))
      }
    } catch (e) {
      setNotice(`Retry failed: ${(e as Error).message}`)
    }
  }, [flush, resolveUrl])

  const move = useCallback((id: string, dir: -1 | 1) => {
    const ls = itemsRef.current
    const i = ls.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ls.length) return
    const next = [...ls]
    ;[next[i], next[j]] = [next[j], next[i]]
    next.forEach((l, k) => { if (l.sortOrder !== k) update(l.id, { sort_order: k }) })
    setItems(next.map((l, k) => ({ ...l, sortOrder: k })))
  }, [update])

  const onLoadState = useCallback((id: string, st: LayerLoadState) => {
    setItems((ls) => ls.map((l) => {
      if (l.id !== id) return l
      if (st.state === 'error') return { ...l, load: st, status: 'error', statusMessage: st.message ?? 'The layer could not be drawn.' }
      return { ...l, load: st }
    }))
    if (st.state === 'error' && canEdit) {
      patchLayer(id, { status: 'error', status_message: st.message ?? 'The layer could not be drawn.' }).catch(console.error)
    }
  }, [canEdit])

  const resolved = useMemo<ResolvedLayer[]>(
    () => items.filter((l) => l.status !== 'error' && urls[l.id]).map((l) => ({
      id: l.id, name: l.name, url: urls[l.id], fileType: l.fileType, visible: l.visible,
      heightOffset: l.heightOffset, clampMode: l.clampMode, reloadKey: reload[l.id] ?? 0, sourceCrs: l.sourceCrs,
    })),
    [items, urls, reload],
  )

  return {
    items, resolved, canEdit, uploading, uploadFailure, dismissUploadFailure: () => setUploadFailure(null),
    notice, limits, upload, update, remove, retry, move, onLoadState,
  }
}

// ── UI ───────────────────────────────────────────────────────────────────────

const mbText = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${Math.round((b / 1024 / 1024) * 10) / 10} MB`)
const ACCEPTED = '.kml,.kmz,.geojson,.json,.czml'
const BTN = 'shrink-0 w-8 h-8 coarse:w-11 coarse:h-11 flex items-center justify-center rounded-lg transition-colors'

function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean
}) {
  return (
    <div role="radiogroup" className={cn('grid gap-1 rounded-xl bg-white/[0.05] p-0.5', disabled && 'opacity-50')} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            'h-8 coarse:h-11 rounded-[10px] text-[11px] font-medium transition-colors',
            value === o.id ? 'bg-[#9ACD3C]/25 text-[#d3f27f] border border-[#9ACD3C]/50' : 'text-white/70 border border-transparent hover:text-white',
          )}
        >{o.label}</button>
      ))}
    </div>
  )
}

/** The layer list and its controls. Used inside the desktop popover and inside the phone bottom sheet. */
export function LayerPanelBody({ ctl }: { ctl: LayersCtl }) {
  const { items, canEdit, limits } = ctl
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [crs, setCrs] = useState<LayerSourceCrs>('EPSG:4326')
  const fileRef = useRef<HTMLInputElement>(null)

  // After a successful upload the selector returns to WGS84, so the next file is never read as ITM by accident
  const doUpload = async (f: File) => { if (await ctl.upload(f, crs)) setCrs('EPSG:4326') }

  const toggleExpand = (id: string) => setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="flex flex-col min-h-0" data-testid="layer-panel">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.15] shrink-0">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">Overlay Layers</span>
        {canEdit && (
          <div className="flex items-center gap-1.5">
            <select
              value={crs} onChange={(e) => setCrs(e.target.value as LayerSourceCrs)}
              aria-label="Source coordinate system of the GeoJSON file"
              title="Source coordinate system (GeoJSON). Layers are stored in WGS84."
              className="h-7 coarse:h-11 rounded-lg bg-white/[0.07] border border-white/15 text-[10px] text-white/85 px-1.5 max-w-[7.5rem]"
            >
              <option value="EPSG:4326">WGS84</option>
              <option value="EPSG:2039">Israel ITM (2039)</option>
            </select>
            <button
              onClick={() => fileRef.current?.click()} disabled={ctl.uploading}
              className="flex items-center gap-1.5 h-7 coarse:h-11 px-2.5 rounded-lg text-[10px] font-medium
                         bg-[#9ACD3C]/20 text-[#b8e05c] border border-[#9ACD3C]/40
                         hover:bg-[#9ACD3C]/30 hover:text-[#d3f27f] disabled:opacity-40 transition-all"
            >
              <Upload className="w-2.5 h-2.5" />
              {ctl.uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input
              ref={fileRef} type="file" accept={ACCEPTED} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doUpload(f) }}
            />
          </div>
        )}
      </div>

      {canEdit && (
        <div className="px-4 py-1.5 text-[10px] text-white/50 border-b border-white/[0.06]">
          GeoJSON, KML, KMZ, CZML · up to {mbText(limits.maxBytes)} · stored as WGS84.
          Over {limits.warnFeatures.toLocaleString('en-US')} features may be slow on phones; over {limits.maxFeatures.toLocaleString('en-US')} is refused.
        </div>
      )}

      {ctl.uploadFailure && (
        <div role="alert" data-testid="upload-error" className="px-4 py-2 text-[11px] text-red-300 border-b border-white/[0.06] bg-red-500/[0.09] flex flex-col gap-1.5">
          <span><strong className="font-semibold">Not uploaded:</strong> {ctl.uploadFailure.message}</span>
          <span className="flex gap-2">
            <button onClick={() => void doUpload(ctl.uploadFailure!.file)}
              className="h-6 coarse:h-11 px-2.5 rounded-lg border border-red-300/40 text-red-200 hover:bg-red-500/15 inline-flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> Retry
            </button>
            <button onClick={ctl.dismissUploadFailure} className="h-6 coarse:h-11 px-2.5 rounded-lg text-white/60 hover:text-white">Dismiss</button>
          </span>
        </div>
      )}
      {ctl.notice && (
        <div role="status" className="px-4 py-2 text-[11px] text-amber-200 border-b border-white/[0.06] bg-amber-500/[0.08]">{ctl.notice}</div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 h-16">
            <Layers className="w-4 h-4 text-white/30" />
            <span className="text-[11px] text-white/55">{canEdit ? 'Upload a KML / KMZ / GeoJSON file' : 'No layers on this model'}</span>
          </div>
        )}
        {items.map((l, idx) => {
          const isOpen = expanded.has(l.id)
          const failed = l.status === 'error'
          const drape = l.clampMode === 'drape'
          const sub = failed
            ? null
            : l.load.state === 'loading' ? 'Loading…'
            : l.featureCount != null ? `${l.featureCount.toLocaleString('en-US')} feature${l.featureCount === 1 ? '' : 's'}` : null
          return (
            <div key={l.id} data-layer-id={l.id} className="border-b border-white/[0.04]">
              <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-white/[0.06] transition-colors">
                <button
                  onClick={() => ctl.update(l.id, { visible: !l.visible })}
                  disabled={failed}
                  title={l.visible ? 'Hide layer' : 'Show layer'}
                  aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`}
                  aria-pressed={l.visible}
                  className={cn(BTN, failed ? 'text-white/20' : l.visible ? 'text-[#9ACD3C]/80 hover:text-[#b8e05c] hover:bg-[#9ACD3C]/10' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]')}
                >
                  {l.visible && !failed ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>

                <div className="flex-1 min-w-0 flex flex-col leading-tight">
                  <span title={l.name} className={cn('text-[12px] truncate', failed ? 'text-red-300' : l.visible ? 'text-white/90' : 'text-white/45 line-through')}>
                    {l.name}
                  </span>
                  {sub && <span className="text-[10px] text-white/45 truncate">{sub}{l.sourceCrs === 'EPSG:2039' ? ' · from ITM' : ''}</span>}
                </div>

                {!failed && !drape && l.heightOffset !== 0 && (
                  <span className="shrink-0 text-[10px] font-mono text-[#9ACD3C]/70">{l.heightOffset > 0 ? '+' : ''}{l.heightOffset}m</span>
                )}

                {canEdit && !failed && (
                  <button
                    onClick={() => toggleExpand(l.id)} title="Layer settings" aria-label={`Settings for ${l.name}`} aria-expanded={isOpen}
                    className={cn(BTN, isOpen ? 'text-[#9ACD3C]/80 bg-[#9ACD3C]/10' : 'text-white/55 hover:text-white/85 hover:bg-white/[0.05]')}
                  >
                    <ChevronsUpDown className="w-3.5 h-3.5" />
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={() => void ctl.remove(l.id)} title="Delete layer" aria-label={`Delete ${l.name}`}
                    className={cn(BTN, 'text-white/55 hover:text-red-400 hover:bg-red-500/10')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {failed && (
                <div role="alert" className="mx-3 mb-2 rounded-lg border border-red-400/30 bg-red-500/[0.08] px-3 py-2 text-[11px] text-red-200 flex flex-col gap-1.5">
                  <span className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /><span>{canEdit ? (l.statusMessage ?? 'This layer could not be shown.') : 'This layer could not be shown.'}</span></span>
                  {canEdit && (
                    <span className="flex gap-2">
                      <button onClick={() => void ctl.retry(l.id)} className="h-6 coarse:h-11 px-2.5 rounded-lg border border-red-300/40 hover:bg-red-500/15 inline-flex items-center gap-1">
                        <RotateCcw className="w-3 h-3" /> Retry
                      </button>
                      <button onClick={() => void ctl.remove(l.id)} className="h-6 coarse:h-11 px-2.5 rounded-lg border border-white/20 text-white/80 hover:bg-white/10">Delete</button>
                    </span>
                  )}
                </div>
              )}
              {!failed && canEdit && l.statusMessage && (
                <div className="mx-3 mb-1.5 text-[10px] text-amber-300/90 flex gap-1.5"><AlertTriangle className="w-3 h-3 shrink-0 mt-px" />{l.statusMessage}</div>
              )}

              {canEdit && !failed && isOpen && (
                <div className="px-4 pb-3 pt-1 flex flex-col gap-3 bg-white/[0.015]">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">Placement</span>
                    <Segmented
                      value={l.clampMode}
                      disabled={l.fileType === 'czml'}
                      onChange={(v) => ctl.update(l.id, { clamp_mode: v })}
                      options={[{ id: 'drape', label: 'Drape on model' }, { id: 'heights', label: 'File heights' }]}
                    />
                    <span className="text-[10px] text-white/45">
                      {l.fileType === 'czml' ? 'CZML files carry their own heights.'
                        : drape ? 'Lines and areas follow the surface of the model.'
                        : l.hasZ ? 'Uses the heights stored in the file.' : 'The file has no heights: it sits on the ellipsoid, not on the model.'}
                    </span>
                  </div>

                  <div className={cn('flex flex-col gap-1.5', drape && 'opacity-40')}>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-semibold tracking-widest uppercase text-white/60">Height Offset</span>
                      <span className="text-[11px] font-mono text-[#b8e05c]">{l.heightOffset >= 0 ? '+' : ''}{l.heightOffset} m</span>
                    </div>
                    <div className="relative h-4 coarse:h-9 flex items-center group/sl">
                      <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.18]" />
                      <div className="absolute h-[3px] rounded-full bg-[#9ACD3C]/85"
                        style={{ left: l.heightOffset >= 0 ? '50%' : `${((l.heightOffset + 200) / 400) * 100}%`, width: `${(Math.abs(l.heightOffset) / 400) * 50}%` }} />
                      <div className="absolute w-[13px] h-[13px] rounded-full bg-white shadow-md ring-[1.5px] ring-black/40 pointer-events-none"
                        style={{ left: `calc(${((l.heightOffset + 200) / 400) * 100}% - 6.5px)` }} />
                      <WheelSlider
                        min={-200} max={200} step={1} value={l.heightOffset}
                        onChange={(v) => { if (!drape) ctl.update(l.id, { height_offset: v }) }}
                        className={cn('absolute inset-x-0 opacity-0 h-4 coarse:h-9 w-full', drape ? 'pointer-events-none' : 'cursor-pointer')}
                      />
                    </div>
                    {drape
                      ? <span className="text-[10px] text-white/50">Offset applies to "File heights" only.</span>
                      : l.heightOffset !== 0 && (
                        <button onClick={() => ctl.update(l.id, { height_offset: 0 })} className="self-end text-[10px] text-white/45 hover:text-white/75 h-5 coarse:h-9">Reset</button>
                      )}
                  </div>

                  <label className="flex items-center justify-between gap-3 min-h-8 coarse:min-h-11 cursor-pointer">
                    <span className="text-[12px] text-white/85">Visible to clients</span>
                    <button
                      type="button" role="switch" aria-checked={l.clientVisible} aria-label={`Visible to clients: ${l.name}`}
                      onClick={() => ctl.update(l.id, { client_visible: !l.clientVisible })}
                      className={cn('relative w-10 h-6 rounded-full border transition-colors shrink-0', l.clientVisible ? 'bg-[#9ACD3C]/60 border-[#9ACD3C]/70' : 'bg-white/10 border-white/20')}
                    >
                      <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all', l.clientVisible ? 'left-[18px]' : 'left-0.5')} />
                    </button>
                  </label>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-white/45 truncate">
                      {l.byteSize != null ? mbText(l.byteSize) : ''}{l.sourceCrs ? ` · source ${l.sourceCrs === 'EPSG:2039' ? 'ITM (2039)' : 'WGS84'}` : ''}
                    </span>
                    <span className="flex gap-1">
                      <button onClick={() => ctl.move(l.id, -1)} disabled={idx === 0} aria-label={`Move ${l.name} up`} title="Move up"
                        className={cn(BTN, 'text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30')}><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button onClick={() => ctl.move(l.id, 1)} disabled={idx === items.length - 1} aria-label={`Move ${l.name} down`} title="Move down"
                        className={cn(BTN, 'text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30')}><ArrowDown className="w-3.5 h-3.5" /></button>
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Desktop popover (button + panel). On phones the same body sits in the bottom sheet. */
export function LayerPanel({ ctl }: { ctl: LayersCtl }) {
  const [open, setOpen] = useState(false)
  const n = ctl.items.length
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 h-8 coarse:h-11 px-3 rounded-xl text-xs font-medium select-none',
          'bg-[#090d0b]/80 backdrop-blur-md border shadow-lg transition-all duration-200',
          open ? 'border-[#9ACD3C]/50 text-[#b8e05c] shadow-[#9ACD3C]/10' : 'border-white/15 text-white/75 hover:text-white/95 hover:border-white/25',
        )}
      >
        <Layers className="w-3.5 h-3.5" />
        <span>Layers</span>
        {n > 0 && (
          <span className="bg-[#9ACD3C]/20 text-[#b8e05c] border border-[#9ACD3C]/25 rounded-full px-1.5 text-[10px] font-semibold">{n}</span>
        )}
        {open ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronUp className="w-3 h-3 opacity-40" />}
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 right-0 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/[0.15]
                        bg-[#0b100d]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 flex flex-col overflow-hidden max-h-[min(34rem,72svh)]">
          <LayerPanelBody ctl={ctl} />
        </div>
      )}
    </div>
  )
}
