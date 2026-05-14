export interface VisualSettings {
  /** Detail quality 1–100 (100 = highest). Maps to Cesium maximumScreenSpaceError 64→1. */
  quality: number
  /** Exposure in EV stops: -2 to +2 */
  exposure: number
  /** Brightness offset: -0.5 to +0.5 */
  brightness: number
  /** Contrast: -1 to +1 */
  contrast: number
  /** Color temperature: -1 (cool/blue) to +1 (warm/orange) */
  temperature: number
  /** Saturation: -1 (greyscale) to +1 (vivid) */
  saturation: number
  /**
   * Vertical translation applied to the 3D Tiles modelMatrix (metres).
   * Corrects ITM orthometric → WGS84 ellipsoidal height mismatch (~17–18 m in Israel).
   * Negative = move down, positive = move up.
   */
  heightOffset: number
}

export const DEFAULT_VISUAL: VisualSettings = {
  quality: 50,
  exposure: 0,
  brightness: 0,
  contrast: 0,
  temperature: 0,
  saturation: 0,
  heightOffset: 0,   // fine-tune only; base correction comes from model.geoid_offset
}

/** Convert quality percentage (1–100) to Cesium maximumScreenSpaceError (64→1) */
export function qualityToSSE(quality: number): number {
  return Math.max(1, Math.round(1 + (64 - 1) * (1 - quality / 100)))
}
