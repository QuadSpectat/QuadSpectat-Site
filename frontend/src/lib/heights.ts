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
 *   - coordinate_system 'itm': native heights are already orthometric (the shift only adds N back for display), H = native.
 *   - anything else (wgs84, custom after "snap to ground", unknown): native heights are ellipsoidal, H = native - N.
 */
export interface HeightRef {
  coordinateSystem?: string
  /** geoid_offset + fine-tune offset currently applied to the model, in metres */
  appliedOffset: number
}

/**
 * The vertical shift a model gets when it is drawn, in metres (the fine-tune slider is added by the caller).
 * 3D Tiles always get the model's geoid_offset. A glTF/GLB model gets it only when the owner has switched
 * `glb_geoid_applied` on (new uploads do): models placed before that keep being drawn at their altitude, unmoved.
 * Either way the read-out undoes exactly the shift that was applied, so the Points panel shows the altitude that was entered
 * (for an 'itm' model) at the ground of the model.
 */
export function modelGeoidShift(m: { model_type?: string; geoid_offset?: number; glb_geoid_applied?: number } | null | undefined): number {
  if (!m) return 0
  const off = typeof m.geoid_offset === 'number' && Number.isFinite(m.geoid_offset) ? m.geoid_offset : 0
  if (m.model_type === '3d-tiles') return off
  return m.glb_geoid_applied ? off : 0
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
