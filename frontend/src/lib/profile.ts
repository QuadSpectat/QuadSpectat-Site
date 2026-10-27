/**
 * Cross-section / elevation profile helpers (pure, no Cesium). Heights are ABOVE SEA LEVEL (EGM2008, indicative),
 * the same convention as the rest of the viewer (see lib/heights.ts).
 */

export interface ProfileSample {
  /** Horizontal distance from the start of the line, metres */
  dist: number
  lat: number
  lon: number
  /** Displayed (ellipsoidal) height, or null where no surface was found */
  hEll: number | null
  /** Height above sea level, or null where no surface / no geoid value */
  hMsl: number | null
}

export interface Profile {
  samples: ProfileSample[]
  /** Horizontal length of the line, metres */
  length: number
  /** Distance between samples, metres */
  spacing: number
  /** Samples with no surface (gaps) */
  gaps: number
}

export interface ProfileStats {
  min: number
  max: number
  /** Height of the last sample with a surface minus the first one (null with fewer than two such samples) */
  netChange: number | null
  /** Slope-style rise over length of the whole line, percent (null if netChange unknown) */
  gradePct: number | null
}

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle (horizontal) distance in metres between two lat/lon points in degrees. */
export function horizontalDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Sample count for a line: about one per `target` metres, between 2 and `max`. */
export function sampleCount(length: number, target = 0.5, max = 300): number {
  if (!(length > 0)) return 2
  return Math.min(max, Math.max(2, Math.round(length / target) + 1))
}

/** Evenly spaced lat/lon stations from a to b (inclusive), linear in degrees (fine for survey-sized lines). */
export function lineStations(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  n: number,
): { dist: number; lat: number; lon: number }[] {
  const length = horizontalDistance(a.lat, a.lon, b.lat, b.lon)
  const out: { dist: number; lat: number; lon: number }[] = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1)
    out.push({ dist: length * t, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t })
  }
  return out
}

export function profileStats(samples: ProfileSample[]): ProfileStats | null {
  const vals = samples.filter((s) => s.hMsl !== null) as (ProfileSample & { hMsl: number })[]
  if (vals.length === 0) return null
  let min = Infinity, max = -Infinity
  for (const s of vals) {
    if (s.hMsl < min) min = s.hMsl
    if (s.hMsl > max) max = s.hMsl
  }
  // Net change runs from the first to the last sample that has a surface: a line that starts or ends just off the model
  // (gap samples at its ends) still reports the rise along the part that is on the surface.
  const first = vals[0]
  const last = vals[vals.length - 1]
  const spanLen = last.dist - first.dist
  const netChange = vals.length >= 2 ? last.hMsl - first.hMsl : null
  const gradePct = netChange !== null && spanLen > 0 ? (netChange / spanLen) * 100 : null
  return { min, max, netChange, gradePct }
}

/** Splits samples into runs of consecutive valid heights, so gaps are drawn as breaks. */
export function validRuns(samples: ProfileSample[]): ProfileSample[][] {
  const runs: ProfileSample[][] = []
  let cur: ProfileSample[] = []
  for (const s of samples) {
    if (s.hMsl === null) {
      if (cur.length) runs.push(cur)
      cur = []
    } else {
      cur.push(s)
    }
  }
  if (cur.length) runs.push(cur)
  return runs
}

const num = (v: number | null, d: number) => (v === null ? '' : v.toFixed(d))

/** CSV text: one row per sample; empty height cells mark gaps. */
export function profileToCsv(p: Profile): string {
  const lines = [
    '# QuadSpectat viewer profile - indicative only. Heights above sea level (EGM2008 geoid, not the Israeli official model).',
    `# Horizontal length ${p.length.toFixed(2)} m, ${p.samples.length} samples, spacing ${p.spacing.toFixed(2)} m, ${p.gaps} gap(s) with no surface.`,
    'distance_m,lat,lon,height_above_sea_level_m,ellipsoid_height_m',
  ]
  for (const s of p.samples) {
    lines.push([s.dist.toFixed(2), s.lat.toFixed(7), s.lon.toFixed(7), num(s.hMsl, 3), num(s.hEll, 3)].join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
