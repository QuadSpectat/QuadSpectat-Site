/**
 * "Cut out Google under the model": while Google 3D is shown, Google's tileset is clipped with a Cesium clipping polygon over the
 * footprint of the owner's model, so the model's own ground replaces Google's (often blurry or mis-sloped) ground and Google 3D
 * stays as context around it. The edge is a hard edge (see the report: a soft edge would need a per-pixel blend shader inside
 * Google's tiles, which is costly and fragile). Clipping is horizontal: it follows the model's footprint on the ground plane and
 * ignores height, so the model's saved Google offset (which only moves it up or down) does not change the cut.
 *
 * The footprint comes from the owner's model only: its surface is sampled on a grid (Google left out of the ray) and the convex hull
 * of the hits is used. Nothing is read from Google's geometry.
 */
import * as Cesium from 'cesium'
import type { Model } from '@/lib/api'
import { waitForTiles } from '@/lib/googleAlign'

export interface XY { x: number; y: number }
export interface Footprint { lon: number; lat: number; hull: XY[]; cell: number; hits: number }

/** Automatic by default: on when the model has a saved Google offset (the owner already aligned it), otherwise off. 1 = on, 2 = off. */
export function cutoutEffective(m: Pick<Model, 'google_cutout' | 'google_offset'> | null | undefined): boolean {
  if (!m) return false
  const c = m.google_cutout ?? 0
  return c === 1 || (c === 0 && Math.abs(m.google_offset ?? 0) > 0.001)
}

export function cutoutSupported(scene: Cesium.Scene): boolean {
  try { return !!Cesium.ClippingPolygonCollection && Cesium.ClippingPolygonCollection.isSupported(scene) } catch { return false }
}

const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
/** Andrew's monotone chain, counter-clockwise. */
export function convexHull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  if (p.length < 3) return p
  const lo: XY[] = [], up: XY[] = []
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q) }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q) }
  return lo.slice(0, -1).concat(up.slice(0, -1))
}

export function polygonArea(h: XY[]): number {
  let a = 0
  for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; a += p.x * q.y - q.x * p.y }
  return a / 2
}

/** Offset of a convex counter-clockwise polygon by `m` metres (outward when positive, inward when negative; mitred corners). */
export function offsetConvex(h: XY[], m: number): XY[] {
  const n = h.length
  if (n < 3 || m === 0) return h
  const nrm = (a: XY, b: XY): XY => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dy / l, y: -dx / l } }   // outward for CCW
  const out = h.map((v, i) => {
    const n1 = nrm(h[(i + n - 1) % n], v), n2 = nrm(v, h[(i + 1) % n])
    const k = m / Math.max(0.25, 1 + n1.x * n2.x + n1.y * n2.y)
    return { x: v.x + (n1.x + n2.x) * k, y: v.y + (n1.y + n2.y) * k }
  })
  // an inward offset that turned the polygon inside out (or collapsed it): keep a small polygon at the centroid instead
  if (m < 0 && polygonArea(out) < 1) { const c = h.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 }); return [{ x: c.x - 1, y: c.y - 1 }, { x: c.x + 1, y: c.y - 1 }, { x: c.x + 1, y: c.y + 1 }, { x: c.x - 1, y: c.y + 1 }] }
  return out
}

/** Sample the owner's model on a grid and return the footprint (convex hull of the hits, in metres east/north of the centre). */
export async function computeFootprint(v: Cesium.Viewer, google: Cesium.Cesium3DTileset, sphere: Cesium.BoundingSphere, modelTilesets: Cesium.Cesium3DTileset[]): Promise<Footprint | null> {
  await waitForTiles(v, modelTilesets, 20000)
  const c = Cesium.Cartographic.fromCartesian(sphere.center)
  const N = 33, R = Math.max(sphere.radius * 1.1, 10)
  const cell = (2 * R) / (N - 1)
  const pts: XY[] = []
  const pos: Cesium.Cartographic[] = []
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = (i / (N - 1) * 2 - 1) * R, y = (j / (N - 1) * 2 - 1) * R
    pts.push({ x, y }); pos.push(new Cesium.Cartographic(c.longitude + x / (6378137 * Math.cos(c.latitude)), c.latitude + y / 6378137))
  }
  const skip: object[] = [google, ...v.entities.values.filter((e) => !e.model)]
  for (let i = 0; i < v.dataSources.length; i++) skip.push(...v.dataSources.get(i).entities.values)
  const got = await v.scene.sampleHeightMostDetailed(pos, skip)
  const hits: XY[] = []
  got.forEach((p, k) => {
    const h = p?.height
    if (typeof h !== 'number' || !Number.isFinite(h)) return
    if (Math.abs(h - (v.scene.globe.getHeight(pos[k]) ?? 0)) < 0.01) return   // the bare globe is not the model
    hits.push(pts[k])
  })
  if (hits.length < 3) return null
  // grow every hit to its cell so the footprint covers the model right up to its edge
  const grown: XY[] = []
  for (const h of hits) for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) grown.push({ x: h.x + dx * cell, y: h.y + dy * cell })
  return { lon: c.longitude, lat: c.latitude, hull: convexHull(grown), cell, hits: hits.length }
}

/** The footprint with the owner's margin, as ground positions for a Cesium clipping polygon. */
export function footprintPositions(fp: Footprint, margin: number): Cesium.Cartesian3[] {
  return offsetConvex(fp.hull, margin).map((p) => Cesium.Cartesian3.fromRadians(fp.lon + p.x / (6378137 * Math.cos(fp.lat)), fp.lat + p.y / 6378137, 0))
}

export function applyCutout(google: Cesium.Cesium3DTileset, positions: Cesium.Cartesian3[] | null): void {
  if (!positions) { google.clippingPolygons = new Cesium.ClippingPolygonCollection({ polygons: [] }); return }
  google.clippingPolygons = new Cesium.ClippingPolygonCollection({ polygons: [new Cesium.ClippingPolygon({ positions })] })
}
