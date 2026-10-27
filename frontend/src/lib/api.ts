import type { CameraState, SavedView } from './views'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

export interface Model {
  id: string
  asset_name: string
  name: string
  description: string | null
  file_key: string | null
  file_size: number | null
  file_type: string | null
  longitude: number
  latitude: number
  altitude: number
  heading: number
  pitch: number
  roll: number
  scale: number
  model_type: 'gltf' | '3d-tiles' | 'pointcloud'
  external_url: string | null
  coordinate_system: string
  geoid_offset: number
  /** 1 = a GLB is drawn shifted by geoid_offset like 3D Tiles (altitude = sea-level height of its ground); 0 = drawn at its altitude as is */
  glb_geoid_applied?: number
  /** 1 = listed and served to anyone without a login (the public demo); set by the owner */
  is_public_demo?: number
  show_watermark: number  // 1 = show, 0 = hide
  watermark_text: string  // text shown as watermark; empty = no watermark
  created_at: string
  updated_at: string
}

export interface CreateModelPayload {
  asset_name: string
  name: string
  description?: string
  file_key?: string
  file_size?: number
  file_type?: string
  longitude?: number
  latitude?: number
  altitude?: number
  heading?: number
  pitch?: number
  roll?: number
  scale?: number
  model_type?: 'gltf' | '3d-tiles' | 'pointcloud'
  external_url?: string
  coordinate_system?: string
  geoid_offset?: number
  glb_geoid_applied?: boolean
  is_public_demo?: boolean
  show_watermark?: boolean
  watermark_text?: string
}

export interface UpdateModelPayload {
  name?: string
  description?: string
  longitude?: number
  latitude?: number
  altitude?: number
  heading?: number
  pitch?: number
  roll?: number
  scale?: number
  coordinate_system?: string
  geoid_offset?: number
  glb_geoid_applied?: boolean
  is_public_demo?: boolean
}

export function getAuthHeader(): { Authorization: string } | Record<string, never> {
  const token = localStorage.getItem('admin_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** apiFetch errors read "<status> <text>". A 5xx answer, or no answer at all (server down / network), is not a problem with the link. */
export function isServerProblem(message: string): boolean {
  return !/^[1-4]\d\d(\s|$)/.test(message)
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeader(), ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  if (res.status === 204) return undefined as unknown as T
  return res.json() as Promise<T>
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export const login = (username: string, password: string) =>
  apiFetch<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const getMe = () =>
  apiFetch<{ username: string }>('/auth/me', { headers: getAuthHeader() })

// ── Age helper ────────────────────────────────────────────────────────────────
export function getAgeInfo(createdAt: string): { days: number; status: 'ok' | 'warning' | 'overdue' } {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)
  const status = days > 365 ? 'overdue' : days > 270 ? 'warning' : 'ok'
  return { days, status }
}

export const listModels = () =>
  apiFetch<Model[]>('/models')

export const listWatermarks = async (): Promise<string[]> => {
  const models = await apiFetch<Model[]>('/models')
  const seen = new Set<string>()
  return models
    .map((m) => m.watermark_text)
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .filter((t) => { if (seen.has(t)) return false; seen.add(t); return true })
}

export const getModel = (id: string) =>
  apiFetch<Model>(`/models/${id}`)

export const createModel = (payload: CreateModelPayload) =>
  apiFetch<Model>('/models', { method: 'POST', body: JSON.stringify(payload) })

export const updateModel = (id: string, payload: UpdateModelPayload) =>
  apiFetch<Model>(`/models/${id}`, { method: 'PUT', body: JSON.stringify(payload) })

export const deleteModel = (id: string) =>
  apiFetch<void>(`/models/${id}`, { method: 'DELETE' })

export const presignUpload = (filename: string, contentType: string) =>
  apiFetch<{ key: string; url: string; expiresIn: number }>('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify({ filename, contentType }),
  })

export const getDownloadUrl = (id: string, shareToken?: string) =>
  apiFetch<{ url: string }>(`/uploads/${id}/download${shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''}`).then((d) => d.url)

/** PUT a file directly to a presigned S3/Spaces URL with upload progress. */
export function uploadToSpaces(
  presignedUrl: string,
  file: Blob,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () =>
      xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`))
    xhr.onerror = () => reject(new Error('Upload network error'))
    xhr.open('PUT', presignedUrl)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.send(file)
  })
}

// ── 3D Tiles (many files under one public prefix) ───────────────────────────
export const presignTilesetFiles = (files: { path: string; contentType: string }[], uploadId?: string) =>
  apiFetch<{ uploadId: string; prefix: string; files: { path: string; key: string; url: string }[] }>(
    '/uploads/tileset/presign', { method: 'POST', body: JSON.stringify({ uploadId, files }) })

export const finalizeTileset = (uploadId: string, expectedFiles: number) =>
  apiFetch<{ external_url: string; file_size: number; count: number; warning?: string }>(
    '/uploads/tileset/finalize', { method: 'POST', body: JSON.stringify({ uploadId, expectedFiles }) })

// ── Share links ──────────────────────────────────────────────────────────────
export interface ShareLink {
  token: string
  label: string | null
  can_edit: boolean
  created_at: string
}

export const createShareLink = (model_id: string, label?: string, can_edit?: boolean) =>
  apiFetch<{ token: string; path: string }>('/share', {
    method: 'POST',
    body: JSON.stringify({ model_id, label, can_edit }),
  })

export const createOrthophotoShareLink = (orthophoto_id: string, label?: string) =>
  apiFetch<{ token: string; path: string }>('/share', {
    method: 'POST',
    body: JSON.stringify({ orthophoto_id, label }),
  })

export const listShareLinks = (model_id: string) =>
  apiFetch<ShareLink[]>(`/share?model_id=${encodeURIComponent(model_id)}`)

export const listOrthophotoShareLinks = (orthophoto_id: string) =>
  apiFetch<ShareLink[]>(`/share?orthophoto_id=${encodeURIComponent(orthophoto_id)}`)

export const deleteShareLink = (token: string) =>
  apiFetch<void>(`/share/${token}`, { method: 'DELETE' })

// Resolve a share token → discriminated union of model or orthophoto
export type ResolvedShare =
  | { kind: 'model';      model: Model;        can_edit: boolean; expires_at?: string }
  | { kind: 'orthophoto'; orthophoto: Orthophoto; can_edit: boolean; expires_at?: string }
export const resolveShareToken = (token: string) =>
  apiFetch<ResolvedShare>(`/share/${token}`)

export const updateModelViaToken = (
  token: string,
  patch: Partial<Pick<Model, 'longitude' | 'latitude' | 'altitude' | 'heading' | 'pitch' | 'roll' | 'scale'>>,
): Promise<Model> =>
  apiFetch<Model>(`/share/${token}/model`, { method: 'PATCH', body: JSON.stringify(patch) })

// ── Layers ───────────────────────────────────────────────────────────────────
export type ClampMode = 'drape' | 'heights'
export type LayerSourceCrs = 'EPSG:4326' | 'EPSG:2039'

/** A layer row. The owner gets every field; share links and the public demo get the first block only. */
export interface Layer {
  id: string
  model_id: string
  name: string
  file_type: string
  visible: number
  /** 'none' = a layer saved before clamp modes existed: file heights untouched (same as 'heights') */
  clamp_mode?: ClampMode | 'none'
  height_offset?: number
  sort_order?: number
  has_z?: number
  status?: 'ready' | 'error'
  // owner only
  file_key?: string
  created_at?: string
  source_name?: string | null
  source_crs?: LayerSourceCrs | null
  status_message?: string | null
  client_visible?: number
  feature_count?: number | null
  byte_size?: number | null
  bbox?: string | null
  opacity?: number
}

export interface LayerLimits { maxBytes: number; warnFeatures: number; maxFeatures: number; extensions: string[]; sourceCrs: string[] }

const shareQ = (shareToken?: string) => (shareToken ? `share=${encodeURIComponent(shareToken)}` : '')

export const listLayers = (model_id: string, shareToken?: string) =>
  apiFetch<Layer[]>(`/layers?model_id=${encodeURIComponent(model_id)}${shareToken ? '&' + shareQ(shareToken) : ''}`)

export const getLayerLimits = () => apiFetch<LayerLimits>('/layers/limits')

export const getLayerDownloadUrl = (id: string, shareToken?: string) =>
  apiFetch<{ url: string }>(`/layers/${id}/download${shareToken ? '?' + shareQ(shareToken) : ''}`).then((d) => d.url)

export const deleteLayer = (id: string) =>
  apiFetch<void>(`/layers/${id}`, { method: 'DELETE' })

export type LayerPatch = Partial<{
  visible: boolean; client_visible: boolean; height_offset: number; opacity: number
  clamp_mode: ClampMode; sort_order: number; name: string; status: 'ready' | 'error'; status_message: string | null
}>

export const patchLayer = (id: string, patch: LayerPatch) =>
  apiFetch<Layer>(`/layers/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })

/** Re-reads the stored file on the server and refreshes the layer's status (the panel's Retry). */
export const recheckLayer = (id: string) =>
  apiFetch<Layer>(`/layers/${id}/recheck`, { method: 'POST' })

/** Uploads one layer file. The server validates it and answers with a plain-language error (thrown as Error.message). */
export async function uploadLayer(file: File, modelId: string, sourceCrs: LayerSourceCrs): Promise<Layer & { warnings?: string[] }> {
  const params = new URLSearchParams({ filename: file.name, model_id: modelId, source_crs: sourceCrs })
  let res: Response
  try {
    // Always octet-stream: the browser would label a .json file application/json
    res = await fetch(`${BASE}/layers/upload?${params.toString()}`, {
      method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', ...getAuthHeader() },
    })
  } catch {
    throw new Error('Could not reach the server. Check the connection and retry.')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    let msg = text
    try { msg = (JSON.parse(text) as { error?: string }).error ?? text } catch { /* not JSON */ }
    if (res.status === 401) msg = 'You are signed out. Sign in again as admin to upload layers.'
    throw new Error(msg)
  }
  return res.json() as Promise<Layer & { warnings?: string[] }>
}

// ── Saved camera views ───────────────────────────────────────────────────────
export type { CameraState, SavedView }

export const listViews = (modelId: string, shareToken?: string) =>
  apiFetch<SavedView[]>(
    `/views?model_id=${encodeURIComponent(modelId)}${shareToken ? `&share=${encodeURIComponent(shareToken)}` : ''}`,
  )

export const createView = (modelId: string, name: string, camera: CameraState) =>
  apiFetch<SavedView>('/views', { method: 'POST', body: JSON.stringify({ model_id: modelId, name, camera }) })

export const deleteView = (id: string) =>
  apiFetch<void>(`/views/${id}`, { method: 'DELETE' })

// ── Orthophotos ───────────────────────────────────────────────────────────────
export interface Orthophoto {
  id: string
  asset_name: string
  name: string
  description: string | null
  file_key: string | null
  cog_key: string | null
  original_format: string | null
  bounds_west:  number | null
  bounds_south: number | null
  bounds_east:  number | null
  bounds_north: number | null
  zoom_min: number
  zoom_max: number
  visible: number   // 0 | 1 (SQLite integer)
  opacity: number   // 0.0 – 1.0
  status: string    // 'pending' | 'processing' | 'ready' | 'error'
  error_message: string | null
  show_watermark: number   // 1 = show, 0 = hide
  watermark_text: string   // empty = no watermark
  sort_order?: number      // stacking order within the asset, higher = drawn on top
  is_public_demo?: number  // 1 = listed and served to anyone without a login (set by the owner)
  created_at: string
  updated_at: string
}

export const listOrthophotos = () =>
  apiFetch<Orthophoto[]>('/orthophotos')

export const getOrthophoto = (id: string) =>
  apiFetch<Orthophoto>(`/orthophotos/${id}`)

export const updateOrthophoto = (id: string, payload: { visible?: boolean; opacity?: number; is_public_demo?: boolean }) =>
  apiFetch<Orthophoto>(`/orthophotos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })

/** Persist the stacking order of one asset's orthophotos. `ids` = the asset's orthophotos, topmost first. */
export const reorderOrthophotos = (ids: string[]) =>
  apiFetch<{ ok: true }>('/orthophotos/order', { method: 'PUT', body: JSON.stringify({ ids }) })

export const deleteOrthophoto = (id: string) =>
  apiFetch<void>(`/orthophotos/${id}`, { method: 'DELETE' })

export const presignOrthophotoUpload = (filename: string, contentType: string) =>
  apiFetch<{ key: string; url: string; expiresIn: number }>('/orthophotos/presign', {
    method: 'POST',
    body: JSON.stringify({ filename, contentType }),
  })

export interface CreateOrthophotoPayload {
  asset_name: string
  name: string
  description?: string
  raw_key: string
  original_format: string
  cog_ready?: boolean
  show_watermark?: boolean
  watermark_text?: string
}

export const createOrthophoto = (payload: CreateOrthophotoPayload) =>
  apiFetch<Orthophoto>('/orthophotos', { method: 'POST', body: JSON.stringify(payload) })

// ── Client pages (one private link per client, valid for one year, no logins) ──
export interface ClientAsset {
  kind: 'model' | 'orthophoto'
  id: string
  name: string
  description: string | null
  type: string
  share_token: string
}
/** What a client's private link loads (public). Rejects with a message starting "410" once the page has expired. */
export interface ClientPageData { name: string; note: string | null; expires_at: string; assets: ClientAsset[] }
export const getClientPage = (token: string) => apiFetch<ClientPageData>(`/client/${token}`)

export interface ClientPageAdmin {
  token: string
  name: string
  note: string | null
  created_at: string
  expires_at: string
  expired: boolean
  path: string
  assets: ClientAsset[]
}
export const listClientPages = () => apiFetch<ClientPageAdmin[]>('/clients')
export const createClientPage = (payload: { name: string; note?: string; assets?: { kind: 'model' | 'orthophoto'; id: string }[] }) =>
  apiFetch<ClientPageAdmin>('/clients', { method: 'POST', body: JSON.stringify(payload) })
export const renewClientPage = (token: string) => apiFetch<ClientPageAdmin>(`/clients/${token}/renew`, { method: 'POST', body: '{}' })
export const deleteClientPage = (token: string) => apiFetch<void>(`/clients/${token}`, { method: 'DELETE' })
export const addClientAsset = (token: string, kind: 'model' | 'orthophoto', id: string) =>
  apiFetch<ClientPageAdmin>(`/clients/${token}/assets`, { method: 'POST', body: JSON.stringify({ kind, id }) })
export const removeClientAsset = (token: string, shareToken: string) =>
  apiFetch<ClientPageAdmin>(`/clients/${token}/assets/${shareToken}`, { method: 'DELETE' })
