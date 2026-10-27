/**
 * "Align to Google 3D" (owner only): works out how far the owner's model has to move up or down so that it sits on Google's
 * surface while Google 3D is shown. The result is one number (metres) that is saved with the model as `google_offset` and
 * applied ONLY while Google 3D is on; the normal view is never changed.
 *
 * Method: a 5 x 5 grid of positions over the model's footprint. At every position the height of Google's surface (the model is
 * left out of the ray) and the height of the model's own surface (Google is left out) are read, and the difference is taken
 * per position. The offset is the MEDIAN of those differences, so a slope, a building or a few bad samples do not matter,
 * and the spread of the differences is reported so the owner can judge the result. Google's data is used only to compute this
 * visual alignment number; nothing from Google is stored or measured beyond it.
 */
import * as Cesium from 'cesium'

export interface GoogleAlignResult {
  /** Total google_offset to save: the offset already applied plus the correction measured now (metres) */
  offset: number
  /** The correction measured now (metres) */
  delta: number
  /** Median heights read at the grid (ellipsoid, as drawn now), metres */
  googleHeight: number
  modelHeight: number
  /** Number of grid positions where both surfaces were found */
  samples: number
  /** Largest minus smallest of the middle half of the differences (metres): how well model and Google agree in shape */
  spread: number
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export async function alignToGoogleSurface(
  v: Cesium.Viewer, google: Cesium.Cesium3DTileset, sphere: Cesium.BoundingSphere, currentOffset: number,
): Promise<GoogleAlignResult> {
  const c = Cesium.Cartographic.fromCartesian(sphere.center)
  const r = Math.min(Math.max(sphere.radius * 0.6, 5), 150)
  const lat = c.latitude, lon = c.longitude
  const grid: Cesium.Cartographic[] = []
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const dE = (i / 2) * r, dN = (j / 2) * r
      grid.push(new Cesium.Cartographic(lon + dE / (6378137 * Math.cos(lat)), lat + dN / 6378137))
    }
  }
  const clone = () => grid.map((p) => new Cesium.Cartographic(p.longitude, p.latitude))
  // everything that is not Google: all other primitives and every entity (the model, layers, pins)
  const notGoogle: object[] = [...v.entities.values]
  for (let i = 0; i < v.dataSources.length; i++) notGoogle.push(...v.dataSources.get(i).entities.values)
  for (let i = 0; i < v.scene.primitives.length; i++) { const p = v.scene.primitives.get(i); if (p !== google) notGoogle.push(p) }
  const gs = await v.scene.sampleHeightMostDetailed(clone(), notGoogle)
  const skipForModel: object[] = [google, ...v.entities.values.filter((e) => !e.model)]
  for (let i = 0; i < v.dataSources.length; i++) skipForModel.push(...v.dataSources.get(i).entities.values)
  const ms = await v.scene.sampleHeightMostDetailed(clone(), skipForModel)
  const g: number[] = [], m: number[] = [], d: number[] = []
  grid.forEach((p, k) => {
    const gh = gs[k]?.height, mh = ms[k]?.height
    if (typeof gh !== 'number' || typeof mh !== 'number' || !Number.isFinite(gh) || !Number.isFinite(mh)) return
    if (Math.abs(mh - (v.scene.globe.getHeight(p) ?? 0)) < 0.01) return   // a hit on the bare globe is not the model
    g.push(gh); m.push(mh); d.push(gh - mh)
  })
  if (d.length < 3) throw new Error('Could not read both surfaces here (found ' + d.length + ' of 25 positions). Zoom to the model, wait until Google 3D has drawn, and try again.')
  const delta = median(d)
  const s = [...d].sort((x, y) => x - y)
  const q1 = s[Math.floor(s.length / 4)], q3 = s[Math.ceil((3 * s.length) / 4) - 1]
  return { offset: currentOffset + delta, delta, googleHeight: median(g), modelHeight: median(m), samples: d.length, spread: q3 - q1 }
}
