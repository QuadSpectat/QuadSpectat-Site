import { geoidUndulation } from '@/lib/geoid'

/**
 * Height conventions.
 *
 * Cesium works in ELLIPSOIDAL heights (h, above the WGS84 ellipsoid). Surveyors and clients want heights ABOVE SEA LEVEL
 * (orthometric, H). They differ by the geoid undulation N: H = h - N (about +17 to +21 m in Israel, EGM2008).
 *
 * A model is shifted vertically by (geoid_offset + the fine-tune slider) when it is shown, so to find the height of a
 * point on the model itself we first undo that shift ("native" height) and then, depending on how the model was
 * authored, either use it directly or subtract N:
 *   - coordinate_system 'itm' (and every model with geoid_mode = 1): native heights are orthometric, H = native (the shift is N for geoid_mode 1).
 *   - anything else (wgs84, custom after "snap to ground", unknown): native heights are ellipsoidal, H = native - N.
 */
export interface HeightRef {
  coordinateSystem?: string
  /** geoid_offset + fine-tune offset currently applied to the model, in metres */
  appliedOffset: number
}

/**
 * The vertical shift a model gets when it is drawn, in metres (the fine-tune slider is added by the caller).
 *
 * Rule (geoid_mode = 1, "orthometric"): the model's heights are heights ABOVE SEA LEVEL, H. The viewer draws it at the ellipsoid
 * height h = H + N, with N the EGM2008 geoid height at the model (about +17 to +22.5 m in Israel), and the Points panel reads
 * H back for any point of the model. For a GLB, H = the altitude entered; for 3D Tiles, H = the heights stored in the tiles.
 *
 * Legacy (geoid_mode = 0), kept so no existing model moves: 3D Tiles are shifted by geoid_offset (the old ITM preset was -17.5,
 * which has the wrong sign for orthometric heights), a GLB is drawn at its altitude.
 * `lat` / `lon` locate the model (a GLB's own position; the middle of a tileset).
 */
export function modelGeoidShift(
  m: { model_type?: string; geoid_offset?: number; geoid_mode?: number } | null | undefined,
  lat?: number, lon?: number,
): number {
  if (!m) return 0
  if (m.geoid_mode) return lat === undefined || lon === undefined ? 0 : (geoidUndulation(lat, lon) ?? 0)
  const off = typeof m.geoid_offset === 'number' && Number.isFinite(m.geoid_offset) ? m.geoid_offset : 0
  return m.model_type === '3d-tiles' ? off : 0
}

/** How the Points panel converts a drawn height of this model back: orthometric models read H directly (see toMsl). */
export function modelCoordinateSystem(m: { coordinate_system?: string; geoid_mode?: number } | null | undefined): string | undefined {
  return m?.geoid_mode ? 'itm' : m?.coordinate_system
}

export const DEFAULT_HEIGHT_REF: HeightRef = { appliedOffset: 0 }

/** Displayed (ellipsoidal) height -> height above sea level, or null when the geoid is unknown at this position. */
export function toMsl(latDeg: number, lonDeg: number, h: number, ref: HeightRef): number | null {
  const native = h - ref.appliedOffset
  if (ref.coordinateSystem === 'itm') return native
  const n = geoidUndulation(latDeg, lonDeg)
  return n === null ? null : native - n
}

/** Height above sea level -> displayed (ellipsoidal) height. Falls back to the value itself outside the geoid grid. */
export function fromMsl(latDeg: number, lonDeg: number, msl: number, ref: HeightRef): number {
  if (ref.coordinateSystem === 'itm') return msl + ref.appliedOffset
  const n = geoidUndulation(latDeg, lonDeg)
  return msl + (n ?? 0) + ref.appliedOffset
}
