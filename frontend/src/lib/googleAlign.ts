/**
 * "Align to Google 3D" (owner only): works out how far the owner's model has to move up or down so that it sits on Google's
 * surface while Google 3D is shown. The result is one number (metres) that is saved with the model as `google_offset` and
 * applied ONLY while Google 3D is on; the normal view is never changed. The model is never tilted (a saved tilt would make
 * distances, areas, volumes and profiles wrong).
 *
 * Overall: a 15 x 15 grid over the model's footprint; at every position the height of Google's surface (the model is left out of
 * the ray) and of the model's own surface (Google is left out) are read, and d = Google - model is taken per position. A robust
 * fit (see alignMath.ts) rejects bridges, buildings and trees; the offset is the median of the ground-like differences, and the
 * residuals on ALL points are reported honestly. At point(s): the owner clicks ground spots on the model; the offset is the mean of
 * the differences around those spots, so the model sits exactly on Google there (and the residuals elsewhere are reported).
 * Sampling waits until the tiles are loaded to full detail, and says so when they are not.
 * Google's data is used only to compute this visual alignment number; nothing from Google is stored or measured beyond it.
 */
import * as Cesium from 'cesium'
import { medianOf, offsetAtPoints, reportFor, reportLines, robustOffset, statsOf } from '@/lib/alignMath'
import type { AlignSample } from '@/lib/alignMath'

export interface GoogleAlignResult {
  /** Total google_offset to save: the offset already applied plus the correction measured now (metres) */
  offset: number
  /** The correction measured now (metres) */
  delta: number
  googleHeight: number
  modelHeight: number
  /** Number of grid positions where both surfaces were found */
  samples: number
  /** Largest minus smallest of the middle half of the differences (metres) */
  spread: number
  /** false when Google 3D (or the model) was still loading while measuring: the number may be off */
  loaded: boolean
  /** How much further to raise the model so that it is above Google on ~90 % of the ground-like points (0 if already) */
  clearDelta: number
  /** Plain-language residual report, one item per line */
  lines: string[]
}

const GRID_N = 15
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait until Google's tileset (and the model's) report every requested tile loaded, up to `ms`. */
export async function waitForTiles(v: Cesium.Viewer, tilesets: Cesium.Cesium3DTileset[], ms = 25000): Promise<boolean> {
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    v.scene.requestRender()
    if (tilesets.every((t) => t.tilesLoaded)) { await sleep(700); if (tilesets.every((t) => t.tilesLoaded)) return true }
    await sleep(400)
  }
  return false
}

interface Excl { notGoogle: object[]; skipForModel: object[] }
function exclusions(v: Cesium.Viewer, google: Cesium.Cesium3DTileset): Excl {
  const notGoogle: object[] = [...v.entities.values]
  for (let i = 0; i < v.dataSources.length; i++) notGoogle.push(...v.dataSources.get(i).entities.values)
  for (let i = 0; i < v.scene.primitives.length; i++) { const p = v.scene.primitives.get(i); if (p !== google) notGoogle.push(p) }
  const skipForModel: object[] = [google, ...v.entities.values.filter((e) => !e.model)]
  for (let i = 0; i < v.dataSources.length; i++) skipForModel.push(...v.dataSources.get(i).entities.values)
  return { notGoogle, skipForModel }
}

/** d = Google - model at the given positions (null where a surface is missing, or the "model" hit is the bare globe). */
async function readD(v: Cesium.Viewer, google: Cesium.Cesium3DTileset, pos: Cesium.Cartographic[]): Promise<{ d: number | null; g: number; m: number }[]> {
  const ex = exclusions(v, google)
  const clone = () => pos.map((p) => new Cesium.Cartographic(p.longitude, p.latitude))
  const gs = await v.scene.sampleHeightMostDetailed(clone(), ex.notGoogle)
  const ms = await v.scene.sampleHeightMostDetailed(clone(), ex.skipForModel)
  return pos.map((p, k) => {
    const gh = gs[k]?.height, mh = ms[k]?.height
    if (typeof gh !== 'number' || typeof mh !== 'number' || !Number.isFinite(gh) || !Number.isFinite(mh)) return { d: null, g: NaN, m: NaN }
    if (Math.abs(mh - (v.scene.globe.getHeight(p) ?? 0)) < 0.01) return { d: null, g: NaN, m: NaN }   // the bare globe is not the model
    return { d: gh - mh, g: gh, m: mh }
  })
}

const localPos = (lon: number, lat: number, x: number, y: number) => new Cesium.Cartographic(lon + x / (6378137 * Math.cos(lat)), lat + y / 6378137)

async function sampleGrid(v: Cesium.Viewer, google: Cesium.Cesium3DTileset, sphere: Cesium.BoundingSphere) {
  const c = Cesium.Cartographic.fromCartesian(sphere.center)
  const r = Math.min(Math.max(sphere.radius * 0.6, 5), 150)
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < GRID_N; i++) for (let j = 0; j < GRID_N; j++) pts.push({ x: ((i / (GRID_N - 1)) * 2 - 1) * r, y: ((j / (GRID_N - 1)) * 2 - 1) * r })
  const got = await readD(v, google, pts.map((p) => localPos(c.longitude, c.latitude, p.x, p.y)))
  const samples: AlignSample[] = []
  const g: number[] = [], m: number[] = []
  pts.forEach((p, k) => { const q = got[k]; if (q.d !== null) { samples.push({ x: p.x, y: p.y, d: q.d }); g.push(q.g); m.push(q.m) } })
  return { samples, g, m, r, c }
}

/** Google's ground has to be readable while measuring: the cut-out (clipping polygon) is switched off for the duration. */
async function withoutCutout<T>(v: Cesium.Viewer, google: Cesium.Cesium3DTileset, fn: () => Promise<T>): Promise<T> {
  const c = google.clippingPolygons
  const was = c ? c.enabled : false
  if (c && was) { c.enabled = false; v.scene.render() }
  try { return await fn() } finally { if (c && was && !c.isDestroyed()) { c.enabled = true; v.scene.requestRender() } }
}

export function alignToGoogleSurface(
  v: Cesium.Viewer, google: Cesium.Cesium3DTileset, sphere: Cesium.BoundingSphere, currentOffset: number, modelTilesets: Cesium.Cesium3DTileset[] = [], mode: 'clear' | 'centred' = 'clear',
): Promise<GoogleAlignResult> {
  return withoutCutout(v, google, () => alignOverall(v, google, sphere, currentOffset, modelTilesets, mode))
}

async function alignOverall(
  v: Cesium.Viewer, google: Cesium.Cesium3DTileset, sphere: Cesium.BoundingSphere, currentOffset: number, modelTilesets: Cesium.Cesium3DTileset[] = [], mode: 'clear' | 'centred' = 'clear',
): Promise<GoogleAlignResult> {
  let loaded = await waitForTiles(v, [google, ...modelTilesets])
  let first = await sampleGrid(v, google, sphere)
  if (first.samples.length < 8) throw new Error(`Could not read both surfaces here (found ${first.samples.length} of ${GRID_N * GRID_N} positions). Zoom to the model, wait until Google 3D has drawn, and try again.`)
  // second look: if Google refined while we measured the numbers move, and we say so
  if (loaded) {
    await waitForTiles(v, [google, ...modelTilesets], 8000)
    const again = await sampleGrid(v, google, sphere)
    const m1 = medianOf(first.samples.map((p) => p.d)), m2 = medianOf(again.samples.map((p) => p.d))
    if (!google.tilesLoaded || Math.abs(m1 - m2) > 0.15) loaded = false
    if (again.samples.length >= first.samples.length) first = again
  }
  const fit0 = robustOffset(first.samples)
  const ins = first.samples.filter((_, i) => fit0.inlier[i]).map((p) => p.d).sort((a, b) => a - b)
  const clear = mode === 'clear' && ins.length ? Math.max(0, ins[Math.floor(0.9 * (ins.length - 1))] - fit0.delta) : 0
  // "Clear Google": the centred fit raised so the model is above Google on ~90 % of the ground-like points
  const fit = { ...fit0, delta: fit0.delta + clear }
  const rep = reportFor(first.samples, fit, first.r * 2)
  const s = first.samples.map((p) => p.d).sort((a, b) => a - b)
  const q1 = s[Math.floor(s.length / 4)], q3 = s[Math.ceil((3 * s.length) / 4) - 1]
  const lines = reportLines(rep)
  if (mode === 'clear') {
    const gres = first.samples.filter((_, i) => fit.inlier[i]).map((p) => p.d - fit.delta)
    const above = gres.filter((v) => v < -0.05), under = gres.filter((v) => v > 0.05)
    const pct = (n: number) => Math.round((100 * n) / Math.max(1, gres.length))
    lines.unshift(`Clear Google (default): the centred fit raised by ${clear.toFixed(2)} m. On the ground-like points the model is above Google on ${pct(above.length)} % (median gap ${above.length ? medianOf(above.map((v) => -v)).toFixed(2) : '0.00'} m, largest gap ${above.length ? Math.max(...above.map((v) => -v)).toFixed(2) : '0.00'} m: it floats there) and under Google on ${pct(under.length)} % (largest ${under.length ? Math.max(...under).toFixed(2) : '0.00'} m).`)
  }
  if (!loaded) lines.unshift('Google 3D (or the model) was still loading while measuring: some tiles were coarse, so this may be off. Wait until everything is sharp and press Align again.')
  return {
    offset: currentOffset + fit.delta, delta: fit.delta, googleHeight: medianOf(first.g), modelHeight: medianOf(first.m), samples: first.samples.length,
    spread: q3 - q1, loaded, clearDelta: 0, lines,
  }
}

/** Align at the chosen ground spots (owner clicks): mean of the differences around them, residuals over the footprint reported. */
export function alignAtPoints(
  v: Cesium.Viewer, google: Cesium.Cesium3DTileset, sphere: Cesium.BoundingSphere, points: Cesium.Cartographic[], currentOffset: number, modelTilesets: Cesium.Cesium3DTileset[] = [],
): Promise<GoogleAlignResult> {
  return withoutCutout(v, google, () => alignPoints(v, google, sphere, points, currentOffset, modelTilesets))
}

async function alignPoints(
  v: Cesium.Viewer, google: Cesium.Cesium3DTileset, sphere: Cesium.BoundingSphere, points: Cesium.Cartographic[], currentOffset: number, modelTilesets: Cesium.Cesium3DTileset[] = [],
): Promise<GoogleAlignResult> {
  const loaded = await waitForTiles(v, [google, ...modelTilesets])
  const per: number[] = [], gl: number[] = [], ml: number[] = []
  for (const p of points) {
    const nb: Cesium.Cartographic[] = []
    for (const dx of [-3, 0, 3]) for (const dy of [-3, 0, 3]) nb.push(localPos(p.longitude, p.latitude, dx, dy))
    const got = (await readD(v, google, nb)).filter((q) => q.d !== null)
    if (got.length < 3) throw new Error('Could not read both surfaces at one of the chosen spots. Click on the model\'s ground and try again.')
    per.push(medianOf(got.map((q) => q.d as number))); gl.push(medianOf(got.map((q) => q.g))); ml.push(medianOf(got.map((q) => q.m)))
  }
  const { delta, spread } = offsetAtPoints(per)
  const grid = await sampleGrid(v, google, sphere)
  const rep = reportFor(grid.samples, { delta, plane: null, inlier: grid.samples.map(() => true), threshold: 0 }, grid.r * 2)
  const all = statsOf(grid.samples.map((p) => p.d - delta))
  const lines = [
    `Aligned at ${points.length} spot${points.length === 1 ? '' : 's'}: Google minus model at the spots (before): ${per.map((x) => (x >= 0 ? '+' : '') + x.toFixed(2)).join(', ')} m${points.length > 1 ? `, spread ${spread.toFixed(2)} m` : ''}.`,
    `Elsewhere on the footprint (${all.n} points): median ${all.median.toFixed(2)} m, min ${all.min.toFixed(2)}, max ${all.max.toFixed(2)}, std ${all.std.toFixed(2)} m (Google minus model).`,
  ]
  if (rep.worst && Math.abs(rep.worst.mean) >= 0.5) lines.push(`Worst side: ${rep.worst.side}: model ${Math.abs(rep.worst.mean).toFixed(1)} m ${rep.worst.mean > 0 ? 'below' : 'above'} Google.`)
  if (!loaded) lines.unshift('Google 3D (or the model) was still loading while measuring: this may be off. Wait until everything is sharp and click again.')
  return { offset: currentOffset + delta, delta, googleHeight: medianOf(gl), modelHeight: medianOf(ml), samples: points.length, spread, loaded, clearDelta: 0, lines }
}
