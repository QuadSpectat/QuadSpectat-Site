/**
 * Runtime performance profile. Chosen once from what the browser tells us (finger pointer, small screen, deviceMemory,
 * hardwareConcurrency, Save-Data) and overridable by the user with the Light mode / High quality toggle, which is
 * remembered in localStorage. Desktop defaults are the same as before this module existed ('high' leaves every
 * Cesium default untouched on non-phones).
 */
import { useSyncExternalStore } from 'react'

export type QualityMode = 'light' | 'high'

interface NavExtras {
  deviceMemory?: number
  connection?: { saveData?: boolean }
}

export interface DeviceInfo {
  phone: boolean
  /** GB as reported by Chromium (capped at 8); undefined on Safari/Firefox. */
  deviceMemory: number | undefined
  cores: number
  saveData: boolean
  /** Weak device: little memory, few cores or data saver. Starts in light mode with a smaller canvas. */
  weak: boolean
}

export function detectDevice(): DeviceInfo {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & NavExtras
  const mm = (q: string) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches
  const smallest = typeof screen !== 'undefined' ? Math.min(screen.width, screen.height) : 1024
  const phone = (mm('(pointer: coarse)') && smallest <= 820) || (typeof innerWidth !== 'undefined' && innerWidth <= 640)
  const deviceMemory = nav.deviceMemory
  const cores = nav.hardwareConcurrency ?? 4
  const saveData = !!nav.connection?.saveData
  const weak = saveData || (deviceMemory !== undefined && deviceMemory <= 2) || (phone && cores <= 4)
  return { phone, deviceMemory, cores, saveData, weak }
}

const KEY = 'qs.quality'

function readStored(): QualityMode | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'high' ? v : null
  } catch { return null }
}

function initialMode(): QualityMode {
  const stored = readStored()
  if (stored) return stored
  return detectDevice().phone ? 'light' : 'high'
}

let mode: QualityMode = typeof window === 'undefined' ? 'high' : initialMode()
const listeners = new Set<() => void>()

export function getQualityMode(): QualityMode { return mode }

export function setQualityMode(next: QualityMode): void {
  if (next === mode) return
  mode = next
  try { localStorage.setItem(KEY, next) } catch { /* private mode: keep for this session only */ }
  listeners.forEach((l) => l())
}

export function useQualityMode(): [QualityMode, (m: QualityMode) => void] {
  const m = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => mode,
    () => 'high' as QualityMode,
  )
  return [m, setQualityMode]
}

const MB = 1024 * 1024

export interface PerfProfile {
  mode: QualityMode
  /** Multiplies the Detail slider's screen-space error (bigger = coarser, cheaper). 1 = unchanged. */
  sseFactor: number
  /** Tileset memory budget (bytes), or undefined to keep Cesium's default (512 MB). */
  cacheBytes?: number
  cacheOverflowBytes?: number
  /** Cap on canvas pixels per CSS pixel. undefined = Cesium default (browser-recommended, i.e. ignore devicePixelRatio). */
  maxPixelRatio?: number
  resolutionScale: number
  msaaSamples?: number
  fog: boolean
  postProcessWhenNeutral: boolean
  globeSse?: number
  globeTileCache?: number
}

/** Pure: same inputs always give the same profile (so it can be unit-checked). */
export function buildProfile(m: QualityMode, d: DeviceInfo): PerfProfile {
  if (m === 'high') {
    if (!d.phone) {
      // Desktop: every default unchanged.
      return { mode: m, sseFactor: 1, resolutionScale: 1, fog: true, postProcessWhenNeutral: true }
    }
    const big = d.deviceMemory !== undefined && d.deviceMemory >= 6
    return {
      mode: m, sseFactor: 1,
      cacheBytes: (big ? 256 : 192) * MB, cacheOverflowBytes: (big ? 192 : 128) * MB,
      maxPixelRatio: big ? 2 : 1.5, resolutionScale: 1, msaaSamples: 2, fog: false, postProcessWhenNeutral: true,
    }
  }
  // Light mode (default on phones, optional everywhere)
  const mem = d.deviceMemory
  const tier = mem === undefined ? 'mid' : mem <= 2 ? 'low' : mem <= 4 ? 'mid' : 'high'
  const cache = { low: [64, 64], mid: [128, 96], high: [256, 128] }[tier]
  return {
    mode: m,
    sseFactor: tier === 'low' || d.saveData ? 1.9 : 1.5,
    cacheBytes: cache[0] * MB, cacheOverflowBytes: cache[1] * MB,
    maxPixelRatio: undefined,
    resolutionScale: tier === 'low' || d.saveData ? 0.75 : 1,
    msaaSamples: 1, fog: false, postProcessWhenNeutral: false,
    globeSse: 3, globeTileCache: 50,
  }
}

export function currentProfile(): PerfProfile { return buildProfile(mode, detectDevice()) }

/** Cesium maximumScreenSpaceError for the Detail slider value under the current profile. */
export function effectiveSse(baseSse: number, profile: PerfProfile = currentProfile()): number {
  return Math.min(128, Math.max(1, Math.round(baseSse * profile.sseFactor * sseBoost)))
}

/** Extra screen-space-error multiplier while red/cyan 3D is on (phones: the tilesets are drawn twice). 1 = none. */
let sseBoost = 1
export function setSseBoost(f: number): void { sseBoost = f }

/** Constructor options for a Cesium3DTileset that carry the memory budget. */
export function tilesetMemoryOptions(profile: PerfProfile = currentProfile()): { cacheBytes?: number; maximumCacheOverflowBytes?: number } {
  return profile.cacheBytes === undefined ? {} : { cacheBytes: profile.cacheBytes, maximumCacheOverflowBytes: profile.cacheOverflowBytes }
}

/** Phone bottom-sheet layout: small screen, or a finger on a tablet below the desktop layout. */
export const PHONE_LAYOUT_QUERY = '(max-width: 640px), (pointer: coarse) and (max-width: 1023px)'
