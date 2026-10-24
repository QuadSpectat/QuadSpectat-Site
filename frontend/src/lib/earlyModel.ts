/**
 * Start fetching the model as early as possible. On /v/<token> the page used to wait for: Cesium download, then the
 * share API, then the tileset root, then the tiles, one after the other. Now the share lookup and the tileset root
 * (plus its first-level child tilesets) are requested while the 3D engine is still downloading.
 *
 * The tileset root JSON is handed straight to Cesium (see takeEarlyTileset), so it is requested exactly once whatever the
 * server's cache headers are. Child tileset JSONs are only warmed in the HTTP cache (a plain GET); they are tiny.
 */
import { resolveShareToken } from '@/lib/api'
import type { ResolvedShare } from '@/lib/api'

const shares = new Map<string, Promise<ResolvedShare>>()
const roots = new Map<string, Promise<unknown>>()

/** Same CDN-bypass rewrite CesiumViewer applies to the model URL (kept in sync by hand; CDN CORS cache issue). */
export function directSpacesUrl(url: string): string {
  return url.replace(/([a-z0-9-]+)\.fra1\.cdn\.digitaloceanspaces\.com/, '$1.fra1.digitaloceanspaces.com')
}

/** Memoised share lookup shared by the early loader and SharedViewer, so the API is called once. */
export function earlyShare(token: string): Promise<ResolvedShare> {
  let p = shares.get(token)
  if (!p) {
    p = resolveShareToken(token)
    p.catch(() => { shares.delete(token) })   // let a retry hit the network again
    shares.set(token, p)
  }
  return p
}

function collectChildJson(node: unknown, base: string, out: string[], depth: number): void {
  if (!node || typeof node !== 'object' || depth > 3 || out.length >= 24) return
  const n = node as { content?: { uri?: string; url?: string }; contents?: { uri?: string }[]; children?: unknown[] }
  const uris = [n.content?.uri ?? n.content?.url, ...(n.contents ?? []).map((c) => c.uri)]
  for (const u of uris) {
    if (u && /\.json(\?|$)/i.test(u) && out.length < 24) {
      try { out.push(new URL(u, base).toString()) } catch { /* ignore bad uri */ }
    }
  }
  n.children?.forEach((c) => collectChildJson(c, base, out, depth + 1))
}

function fetchRoot(url: string): Promise<unknown> {
  const p = fetch(url, { mode: 'cors', credentials: 'omit' }).then((r) => {
    if (!r.ok) throw new Error(`tileset ${r.status}`)
    return r.json() as Promise<{ root?: unknown }>
  }).then((json) => {
    const kids: string[] = []
    collectChildJson((json as { root?: unknown }).root, url, kids, 0)
    kids.forEach((k) => { void fetch(k, { mode: 'cors', credentials: 'omit' }).then((r) => r.arrayBuffer()).catch(() => undefined) })
    return json
  })
  p.catch(() => { roots.delete(url) })
  return p
}

/** Begin early work for the current route. Safe to call for any path; does nothing when there is nothing to start. */
/** Public model bucket (same host the CDN-bypass rewrite points at). Opening the connection early saves a round trip. */
const MODEL_HOST = 'https://quadspectat-models.fra1.digitaloceanspaces.com'

function preconnect(href: string): void {
  if (document.querySelector('link[rel=preconnect][href="' + href + '"]')) return
  const l = document.createElement('link')
  l.rel = 'preconnect'; l.href = href; l.crossOrigin = 'anonymous'
  document.head.appendChild(l)
}

export function startEarlyLoad(pathname: string): void {
  try {
    if (/^\/(v\/|app)/.test(pathname)) preconnect(MODEL_HOST)
    const m = /^\/v\/([^/]+)/.exec(pathname)
    if (!m) return
    void earlyShare(decodeURIComponent(m[1])).then((s) => {
      if (s.kind !== 'model') return
      const model = s.model
      if (model.model_type !== '3d-tiles' || !model.external_url) return
      const url = directSpacesUrl(model.external_url)
      if (!roots.has(url)) roots.set(url, fetchRoot(url))
    }).catch(() => undefined)
  } catch { /* early loading is an optimisation only */ }
}

/** Hand the pre-fetched tileset JSON to Cesium (once). undefined = nothing was started for this URL. */
export function takeEarlyTileset(url: string): Promise<unknown> | undefined {
  const p = roots.get(url)
  if (p) roots.delete(url)
  return p
}
