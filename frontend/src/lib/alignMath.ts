/**
 * Pure maths for "Align to Google 3D" (no Cesium). Every sample is a position on the model's footprint (x = metres east, y =
 * metres north of the footprint centre) with d = Google height minus the model's own height there (ellipsoid, as drawn now).
 *
 * Why one vertical offset cannot fit everywhere: d is not a constant. Google's surface carries bridges, buildings and trees that
 * the model's ground does not (or the other way round), both have their own vertical errors, and a tilt / scale / georeference
 * error between them makes d change smoothly across the footprint. The saved model stays a pure vertical offset (a saved tilt
 * would turn distances, areas, volumes and profiles wrong), so the aim is the best single height, plus an honest report of how
 * far off it is in every direction.
 */

export interface AlignSample { x: number; y: number; d: number }

export const medianOf = (a: number[]): number => {
  if (!a.length) return NaN
  const s = [...a].sort((p, q) => p - q)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Plane { a: number; b: number; c: number }   // d = a + b*x + c*y

/** Least-squares plane through points (normal equations); null when the points are degenerate. */
export function fitPlane(pts: AlignSample[]): Plane | null {
  const n = pts.length
  if (n < 3) return null
  let sx = 0, sy = 0, sd = 0, sxx = 0, sxy = 0, syy = 0, sxd = 0, syd = 0
  for (const p of pts) { sx += p.x; sy += p.y; sd += p.d; sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y; sxd += p.x * p.d; syd += p.y * p.d }
  // [n sx sy; sx sxx sxy; sy sxy syy] * [a b c]' = [sd sxd syd]'
  const M = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]]
  const R = [sd, sxd, syd]
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det(M)
  if (!Number.isFinite(D) || Math.abs(D) < 1e-9) return null
  const col = (k: number) => M.map((row, i) => row.map((v, j) => (j === k ? R[i] : v)))
  return { a: det(col(0)) / D, b: det(col(1)) / D, c: det(col(2)) / D }
}

const at = (p: Plane, x: number, y: number) => p.a + p.b * x + p.c * y

/** Small deterministic generator so the same samples always give the same answer (and tests are repeatable). */
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 } }

export interface RobustFit {
  /** vertical offset to apply: median of d over the ground-like samples (inliers) */
  delta: number
  plane: Plane | null
  inlier: boolean[]
  /** inlier threshold used (metres) */
  threshold: number
}

/**
 * Robust estimate of the vertical offset. A plane d = a + bx + cy is found by RANSAC (fixed seed) so that bridges, buildings,
 * trees and gross errors (they sit far from the ground plane) are rejected; the offset is the median of d over the inliers
 * (the plane's tilt is only a diagnostic, it is not applied).
 */
export function robustOffset(s: AlignSample[], iterations = 400): RobustFit {
  const n = s.length
  const d = s.map((p) => p.d)
  const med = medianOf(d)
  const mad = medianOf(d.map((v) => Math.abs(v - med))) * 1.4826
  const thr = Math.min(3, Math.max(0.6, 2.5 * mad))
  const rnd = rng(12345)
  let best: Plane | null = null
  let bestIn = -1
  let bestSum = Infinity
  for (let it = 0; it < iterations && n >= 3; it++) {
    const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n), k = Math.floor(rnd() * n)
    if (i === j || j === k || i === k) continue
    const pl = fitPlane([s[i], s[j], s[k]])
    if (!pl) continue
    let cnt = 0, sum = 0
    for (const p of s) { const r = Math.abs(p.d - at(pl, p.x, p.y)); if (r < thr) { cnt++; sum += r } }
    if (cnt > bestIn || (cnt === bestIn && sum < bestSum)) { best = pl; bestIn = cnt; bestSum = sum }
  }
  let inlier = s.map((p) => (best ? Math.abs(p.d - at(best, p.x, p.y)) < thr : true))
  for (let round = 0; round < 3 && best; round++) {   // refit on the inliers, re-select
    const pl = fitPlane(s.filter((_, i) => inlier[i]))
    if (!pl) break
    best = pl
    inlier = s.map((p) => Math.abs(p.d - at(pl, p.x, p.y)) < thr)
  }
  const ins = s.filter((_, i) => inlier[i]).map((p) => p.d)
  return { delta: ins.length ? medianOf(ins) : med, plane: best, inlier, threshold: thr }
}

export interface Stats { n: number; median: number; min: number; max: number; std: number }
export function statsOf(v: number[]): Stats {
  const n = v.length
  if (!n) return { n: 0, median: NaN, min: NaN, max: NaN, std: NaN }
  const mean = v.reduce((a, b) => a + b, 0) / n
  return { n, median: medianOf(v), min: Math.min(...v), max: Math.max(...v), std: Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n) }
}

const SECTORS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east']
export interface SectorWorst { side: string; mean: number }
/** The compass side of the footprint where the ground-like residual is largest (positive = model below Google). */
export function worstSector(s: AlignSample[], resid: number[], use: boolean[]): SectorWorst | null {
  const acc = SECTORS.map(() => ({ sum: 0, n: 0 }))
  s.forEach((p, i) => {
    if (!use[i] || (Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6)) return
    const k = Math.round(Math.atan2(p.y, p.x) / (Math.PI / 4)) & 7
    acc[k].sum += resid[i]; acc[k].n++
  })
  let w: SectorWorst | null = null
  acc.forEach((a, k) => { if (a.n >= 3 && (!w || Math.abs(a.sum / a.n) > Math.abs(w.mean))) w = { side: SECTORS[k], mean: a.sum / a.n } })
  return w
}

/** Tilt of the ground plane: metres of change of d across the footprint diameter and the direction in which d grows. */
export function tiltOf(plane: Plane | null, diameter: number): { across: number; degrees: number; toward: string } | null {
  if (!plane) return null
  const g = Math.hypot(plane.b, plane.c)
  const k = Math.round(Math.atan2(plane.c, plane.b) / (Math.PI / 4)) & 7
  return { across: g * diameter, degrees: (Math.atan(g) * 180) / Math.PI, toward: SECTORS[k] }
}

export interface AlignReport {
  delta: number
  all: Stats
  ground: Stats
  worst: SectorWorst | null
  tilt: { across: number; degrees: number; toward: string } | null
  groundShare: number
}

/** Everything the owner reads back after an overall alignment (residual = Google minus model AFTER applying delta). */
export function reportFor(s: AlignSample[], fit: RobustFit, diameter: number): AlignReport {
  const resid = s.map((p) => p.d - fit.delta)
  const ground = resid.filter((_, i) => fit.inlier[i])
  return {
    delta: fit.delta, all: statsOf(resid), ground: statsOf(ground),
    worst: worstSector(s, resid, fit.inlier), tilt: tiltOf(fit.plane, diameter), groundShare: s.length ? ground.length / s.length : 0,
  }
}

const f2 = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2)

/** Plain-language lines for the panel (English; the Hebrew help text is static in the panel). */
export function reportLines(r: AlignReport): string[] {
  const out: string[] = []
  out.push(`Residual (Google minus model) on the ground-like ${r.ground.n} of ${r.all.n} points: median ${f2(r.ground.median)} m, min ${f2(r.ground.min)}, max ${f2(r.ground.max)}, std ${r.ground.std.toFixed(2)} m.`)
  out.push(`On all ${r.all.n} points (bridges, buildings, trees included): min ${f2(r.all.min)}, max ${f2(r.all.max)}, std ${r.all.std.toFixed(2)} m.`)
  if (r.worst && Math.abs(r.worst.mean) >= 0.5) {
    out.push(`Worst side: ${r.worst.side}: model ${Math.abs(r.worst.mean).toFixed(1)} m ${r.worst.mean > 0 ? 'below' : 'above'} Google.`)
  }
  if (r.tilt && r.tilt.across >= 0.5) {
    out.push(`The two surfaces tilt against each other by ${r.tilt.across.toFixed(1)} m across the footprint (${r.tilt.degrees.toFixed(2)} deg, Google higher toward the ${r.tilt.toward}); one height cannot fit everywhere. Use Align at point where it matters.`)
  }
  return out
}

/** Align at point(s): d measured around each chosen spot (median of a small neighbourhood); the offset is the mean of the spots. */
export function offsetAtPoints(perPoint: number[]): { delta: number; spread: number } {
  const n = perPoint.length
  const delta = n ? perPoint.reduce((a, b) => a + b, 0) / n : NaN
  return { delta, spread: n ? Math.max(...perPoint) - Math.min(...perPoint) : NaN }
}
