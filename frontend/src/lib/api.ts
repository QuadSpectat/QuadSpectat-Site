const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

export interface Model {
  id: string
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
  created_at: string
  updated_at: string
}

export interface CreateModelPayload {
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
}

function getAuthHeader(): { Authorization: string } | Record<string, never> {
  const token = localStorage.getItem('admin_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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

export const getDownloadUrl = (id: string) =>
  apiFetch<{ url: string }>(`/uploads/${id}/download`).then((d) => d.url)

/** PUT a file directly to a presigned S3/Spaces URL with upload progress. */
export function uploadToSpaces(
  presignedUrl: string,
  file: File,
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

export const listShareLinks = (model_id: string) =>
  apiFetch<ShareLink[]>(`/share?model_id=${encodeURIComponent(model_id)}`)

export const deleteShareLink = (token: string) =>
  apiFetch<void>(`/share/${token}`, { method: 'DELETE' })

// Resolve a share token → { model, can_edit } (used on the public viewer page)
export const resolveShareToken = (token: string) =>
  apiFetch<{ model: Model; can_edit: boolean }>(`/share/${token}`)

export const updateModelViaToken = (
  token: string,
  patch: Partial<Pick<Model, 'longitude' | 'latitude' | 'altitude' | 'heading' | 'pitch' | 'roll' | 'scale'>>,
): Promise<Model> =>
  apiFetch<Model>(`/share/${token}/model`, { method: 'PATCH', body: JSON.stringify(patch) })

// ── Layers ───────────────────────────────────────────────────────────────────
export interface Layer {
  id: string
  model_id: string
  name: string
  file_key: string
  file_type: string
  visible: number
  created_at: string
}

export const listLayers = (model_id: string) =>
  apiFetch<Layer[]>(`/layers?model_id=${encodeURIComponent(model_id)}`)

export const presignLayerUpload = (filename: string, contentType: string, model_id: string) =>
  apiFetch<{ key: string; url: string }>('/layers/presign', {
    method: 'POST',
    body: JSON.stringify({ filename, contentType, model_id }),
  })

export const createLayer = (payload: { model_id: string; name: string; file_key: string; file_type: string }) =>
  apiFetch<Layer>('/layers', { method: 'POST', body: JSON.stringify(payload) })

export const getLayerDownloadUrl = (id: string) =>
  apiFetch<{ url: string }>(`/layers/${id}/download`).then((d) => d.url)

export const deleteLayer = (id: string) =>
  apiFetch<void>(`/layers/${id}`, { method: 'DELETE' })

// ── Orthophotos ───────────────────────────────────────────────────────────────
export interface Orthophoto {
  id: string
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
  created_at: string
  updated_at: string
}

export const listOrthophotos = () =>
  apiFetch<Orthophoto[]>('/orthophotos')

export const getOrthophoto = (id: string) =>
  apiFetch<Orthophoto>(`/orthophotos/${id}`)

export const updateOrthophoto = (id: string, payload: { visible?: boolean; opacity?: number }) =>
  apiFetch<Orthophoto>(`/orthophotos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })

export const deleteOrthophoto = (id: string) =>
  apiFetch<void>(`/orthophotos/${id}`, { method: 'DELETE' })

export const presignOrthophotoUpload = (filename: string, contentType: string) =>
  apiFetch<{ key: string; url: string; expiresIn: number }>('/orthophotos/presign', {
    method: 'POST',
    body: JSON.stringify({ filename, contentType }),
  })

export interface CreateOrthophotoPayload {
  name: string
  description?: string
  raw_key: string
  original_format: string
}

export const createOrthophoto = (payload: CreateOrthophotoPayload) =>
  apiFetch<Orthophoto>('/orthophotos', { method: 'POST', body: JSON.stringify(payload) })
