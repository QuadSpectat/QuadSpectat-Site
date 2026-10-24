/**
 * 3D Tiles upload: folder or .zip -> list of files -> presigned PUT of every file to Spaces
 * under one public prefix -> finalize (server checks the root json + public read) -> external_url.
 * Nothing is streamed through the API server.
 */
import { unzip } from 'fflate'
import { presignTilesetFiles, finalizeTileset, uploadToSpaces } from './api'

export interface TileFile { path: string; body: Blob }
export interface TilesetResult { external_url: string; file_size: number; count: number; warning?: string }

const TYPES: Record<string, string> = {
  json: 'application/json', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ktx2: 'image/ktx2',
  b3dm: 'application/octet-stream', i3dm: 'application/octet-stream', pnts: 'application/octet-stream',
  cmpt: 'application/octet-stream', subtree: 'application/octet-stream', bin: 'application/octet-stream',
}
export function tileContentType(path: string): string {
  return TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i
const ALLOWED = /^[A-Za-z0-9._()+@=,\- ]+(\/[A-Za-z0-9._()+@=,\- ]+)*$/
const ROOT_NAMES = ['tileset.json', 'cesium.json']

/** Strip the folder above the root tileset json so it ends up at the prefix root; validate names. */
export function normaliseTileset(raw: { path: string; body: Blob }[]): TileFile[] {
  const files = raw
    .map((f) => ({ path: f.path.split('\\').join('/').replace(/^\/+/, ''), body: f.body }))
    .filter((f) => f.path && !f.path.endsWith('/') && !JUNK.test(f.path))
  const roots = files
    .filter((f) => ROOT_NAMES.includes(f.path.split('/').pop()!.toLowerCase()))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  if (!roots.length) throw new Error('No tileset.json (or Cesium.json) found in the selection')
  const dir = roots[0].path.includes('/') ? roots[0].path.slice(0, roots[0].path.lastIndexOf('/') + 1) : ''
  const out = files.filter((f) => f.path.startsWith(dir)).map((f) => ({ path: f.path.slice(dir.length), body: f.body }))
  const bad = out.filter((f) => !ALLOWED.test(f.path) || f.path.split('/').includes('..'))
  if (bad.length) {
    throw new Error(
      `${bad.length} file name(s) contain characters that are not allowed (letters, digits and . _ ( ) + @ = , - space only), e.g. "${bad[0].path}"`,
    )
  }
  return out
}

/** Files from <input webkitdirectory>. */
export function readFolder(list: FileList | File[]): TileFile[] {
  return normaliseTileset(
    Array.from(list).map((f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, body: f })),
  )
}

/** Unzip fully in the browser (fflate, off the main thread). Practical up to roughly 1-1.5 GB; use a folder beyond that. */
export function readZip(file: File): Promise<TileFile[]> {
  return new Promise((resolve, reject) => {
    file.arrayBuffer().then((buf) => {
      unzip(new Uint8Array(buf), (err, data) => {
        if (err) { reject(new Error(`Could not read the zip: ${err.message}`)); return }
        try {
          resolve(normaliseTileset(Object.entries(data).map(([path, bytes]) => ({
            path, body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: tileContentType(path) }),
          }))))
        } catch (e) { reject(e as Error) }
      })
    }, reject)
  })
}

/** Upload with limited concurrency and retries; progress is by bytes (0-100). */
export async function uploadTileset(
  files: TileFile[],
  onProgress: (pct: number, label: string) => void,
  concurrency = 6,
): Promise<TilesetResult> {
  const total = files.reduce((a, f) => a + f.body.size, 0) || 1
  const done = new Map<string, number>()
  const report = (label: string) =>
    onProgress(Math.round(([...done.values()].reduce((a, b) => a + b, 0) / total) * 100), label)

  let uploadId: string | undefined
  for (let i = 0; i < files.length; i += 500) {
    const batch = files.slice(i, i + 500)
    const pre = await presignTilesetFiles(batch.map((f) => ({ path: f.path, contentType: tileContentType(f.path) })), uploadId)
    uploadId = pre.uploadId
    const byPath = new Map(pre.files.map((p) => [p.path, p.url]))
    let next = 0
    const worker = async () => {
      while (next < batch.length) {
        const f = batch[next++]
        const url = byPath.get(f.path)!
        const blob = f.body.type === tileContentType(f.path) ? f.body : new Blob([f.body], { type: tileContentType(f.path) })
        let lastErr: unknown
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await uploadToSpaces(url, blob, (p) => { done.set(f.path, (blob.size * p) / 100); report(`${done.size}/${files.length} files`) })
            lastErr = undefined
            break
          } catch (e) { lastErr = e; done.set(f.path, 0) }
        }
        if (lastErr) throw new Error(`${f.path}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
        done.set(f.path, blob.size)
        report(`${[...done.values()].filter(Boolean).length}/${files.length} files`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker))
  }
  onProgress(100, 'verifying')
  return finalizeTileset(uploadId!, files.length)
}
