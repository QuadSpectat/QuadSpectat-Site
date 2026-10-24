import { useEffect } from 'react'
import * as Cesium from 'cesium'
import { buildProfile, detectDevice, useQualityMode } from '@/lib/deviceProfile'
import type { PerfProfile } from '@/lib/deviceProfile'

/** Applies the Cesium scene/canvas side of the performance profile. Tileset side: see tilesetMemoryOptions/effectiveSse. */
export function applyScenePerformance(v: Cesium.Viewer, p: PerfProfile, dpr: number = window.devicePixelRatio || 1): void {
  if (v.isDestroyed()) return
  const scene = v.scene
  if (p.maxPixelRatio !== undefined) {
    // Phone "High quality": real pixels, but capped. Effective ratio = devicePixelRatio * resolutionScale.
    v.useBrowserRecommendedResolution = false
    v.resolutionScale = Math.min(dpr, p.maxPixelRatio) / dpr
  } else {
    v.useBrowserRecommendedResolution = true   // Cesium default: CSS pixels, devicePixelRatio ignored
    v.resolutionScale = p.resolutionScale
  }
  if (p.msaaSamples !== undefined && scene.msaaSamples !== p.msaaSamples && scene.msaaSupported) scene.msaaSamples = p.msaaSamples
  scene.fog.enabled = p.fog
  v.shadows = false
  scene.globe.maximumScreenSpaceError = p.globeSse ?? 2
  scene.globe.tileCacheSize = p.globeTileCache ?? 100
  scene.requestRender()
}

export function usePerformanceProfile(viewer: Cesium.Viewer | null): PerfProfile {
  const [mode] = useQualityMode()
  const profile = buildProfile(mode, detectDevice())
  useEffect(() => {
    if (viewer) applyScenePerformance(viewer, profile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, mode])
  return profile
}
