/**
 * Some photogrammetry exports (e.g. person/object scans from projected-CRS pipelines) are written with a
 * CESIUM_RTC extension whose "center" is a projected coordinate (UTM/ITM easting, northing, 0) and Z-up
 * geometry in local metres. Cesium treats that centre as a metre offset in model space, so the model is
 * drawn thousands of kilometres from the entity's position: nothing visible, flyTo never lands.
 *
 * prepareGlb() detects that case, and returns a blob URL of a corrected copy: the RTC extension is dropped
 * and a parent node stands the model upright (Z-up -> glTF Y-up), centres it horizontally and puts its
 * lowest point at the entity altitude. Any other GLB is returned untouched (same URL, no extra download).
 */

export interface PreparedGlb { url: string; note?: string; revoke?: () => void }

const MAGIC = 0x46546c67   // 'glTF'
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const RTC_LIMIT = 1e5      // a genuine RTC centre is small; projected coordinates are in the hundreds of km

interface Gltf {
  extensions?: Record<string, { center?: number[] }>
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes?: Record<string, unknown>[]
  meshes?: { primitives: { attributes: Record<string, number> }[] }[]
  accessors?: { min?: number[]; max?: number[] }[]
}

function parseJsonChunk(buf: ArrayBuffer): { json: Gltf; jsonEnd: number } | null {
  if (buf.byteLength < 20) return null
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== MAGIC) return null
  const len = dv.getUint32(12, true)
  if (dv.getUint32(16, true) !== CHUNK_JSON || 20 + len > buf.byteLength) return null
  try {
    return { json: JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len))) as Gltf, jsonEnd: 20 + len }
  } catch { return null }
}

function positionBounds(g: Gltf): { min: number[]; max: number[] } | null {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const m of g.meshes ?? []) {
    for (const p of m.primitives) {
      const a = g.accessors?.[p.attributes.POSITION]
      if (!a?.min || !a.max) continue
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i]); max[i] = Math.max(max[i], a.max[i]) }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null
}

export async function prepareGlb(url: string): Promise<PreparedGlb> {
  try {
    // Peek at the JSON chunk only (Range), so ordinary models are not downloaded twice.
    const head = await fetch(url, { headers: { Range: 'bytes=0-524287' } })
    if (!head.ok) return { url }
    const peek = await head.arrayBuffer()
    const parsed = parseJsonChunk(peek)
    const c = parsed?.json.extensions?.CESIUM_RTC?.center
    if (!parsed || !c || Math.hypot(c[0], c[1], c[2]) < RTC_LIMIT) return { url }

    const full = head.status === 200 ? peek : await (await fetch(url)).arrayBuffer()
    const p2 = parseJsonChunk(full)
    if (!p2) return { url }
    const g = p2.json
    const b = positionBounds(g)
    if (!b) return { url }

    // Z-up -> Y-up:  x' = x - cx,  y' = z - zmin,  z' = -(y - cy)
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, zmin = b.min[2]
    const matrix = [1, 0, 0, 0,  0, 0, -1, 0,  0, 1, 0, 0,  -cx, -zmin, cy, 1]
    const scene = g.scenes?.[g.scene ?? 0]
    const nodes = g.nodes ?? (g.nodes = [])
    const roots = scene?.nodes ?? []
    nodes.push({ matrix, children: roots })
    if (scene) scene.nodes = [nodes.length - 1]
    delete g.extensions!.CESIUM_RTC
    if (Object.keys(g.extensions!).length === 0) delete g.extensions
    g.extensionsUsed = (g.extensionsUsed ?? []).filter((e) => e !== 'CESIUM_RTC')
    g.extensionsRequired = (g.extensionsRequired ?? []).filter((e) => e !== 'CESIUM_RTC')
    if (!g.extensionsRequired.length) delete g.extensionsRequired

    // Re-pack: header + new JSON chunk (space padded) + original remaining chunks
    const jsonBytes = new TextEncoder().encode(JSON.stringify(g))
    const padded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4).fill(0x20)
    padded.set(jsonBytes)
    const rest = new Uint8Array(full, p2.jsonEnd)
    const out = new Uint8Array(20 + padded.length + rest.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, MAGIC, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true)
    dv.setUint32(12, padded.length, true); dv.setUint32(16, CHUNK_JSON, true)
    out.set(padded, 20)
    out.set(rest, 20 + padded.length)
    void CHUNK_BIN
    const blobUrl = URL.createObjectURL(new Blob([out], { type: 'model/gltf-binary' }))
    return {
      url: blobUrl,
      revoke: () => URL.revokeObjectURL(blobUrl),
      note: `This GLB is georeferenced in projected coordinates (CESIUM_RTC centre ${Math.round(c[0])}, ${Math.round(c[1])}). ` +
        'It is shown upright at the latitude / longitude / altitude set for the model, with its lowest point at that altitude.',
    }
  } catch {
    return { url }   // any failure: fall back to loading the file as it is
  }
}
