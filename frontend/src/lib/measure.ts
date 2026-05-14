import * as Cesium from 'cesium'

export type MeasureMode = 'none' | 'distance' | 'area' | 'volume'

// ── Geometry ─────────────────────────────────────────────────────────────────

export function centroid(pts: Cesium.Cartesian3[]): Cesium.Cartesian3 {
  const sum = pts.reduce(
    (acc, p) => Cesium.Cartesian3.add(acc, p, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  )
  return Cesium.Cartesian3.divideByScalar(sum, pts.length, new Cesium.Cartesian3())
}

export function computeDistance(pts: Cesium.Cartesian3[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += Cesium.Cartesian3.distance(pts[i - 1], pts[i])
  }
  return total
}

/**
 * Signed area of a polygon projected onto the ENU tangent plane at its centroid.
 * Uses the Shoelace formula over East/North components.
 */
export function computeArea(pts: Cesium.Cartesian3[]): number {
  if (pts.length < 3) return 0

  const cent = centroid(pts)
  const toLocal = Cesium.Matrix4.inverseTransformation(
    Cesium.Transforms.eastNorthUpToFixedFrame(cent),
    new Cesium.Matrix4(),
  )
  const local = pts.map((p) =>
    Cesium.Matrix4.multiplyByPoint(toLocal, p, new Cesium.Cartesian3()),
  )

  let area = 0
  const n = local.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += local[i].x * local[j].y - local[j].x * local[i].y
  }
  return Math.abs(area) / 2
}

/**
 * Volume of the solid between the polygon surface (terrain heights) and a flat
 * base-elevation plane, using fan triangulation from vertex 0.
 */
export function computeVolume(pts: Cesium.Cartesian3[], baseElevation: number): number {
  if (pts.length < 3) return 0

  const heights = pts.map((p) =>
    Math.max(0, Cesium.Cartographic.fromCartesian(p).height - baseElevation),
  )

  let vol = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const triArea = computeArea([pts[0], pts[i], pts[i + 1]])
    const avgH = (heights[0] + heights[i] + heights[i + 1]) / 3
    vol += triArea * avgH
  }
  return vol
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatDistance(m: number): string {
  if (m >= 1_000) return `${(m / 1_000).toFixed(3)} km`
  return `${m.toFixed(2)} m`
}

export function formatArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(4)} km²`
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(4)} ha`
  return `${m2.toFixed(2)} m²`
}

export function formatVolume(m3: number): string {
  if (m3 >= 1_000_000_000) return `${(m3 / 1e9).toFixed(4)} km³`
  if (m3 >= 1_000_000) return `${(m3 / 1e6).toFixed(4)} Mm³`
  return `${m3.toFixed(2)} m³`
}
