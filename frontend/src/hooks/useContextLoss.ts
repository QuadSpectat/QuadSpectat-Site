import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'

export type GpuState = 'ok' | 'lost' | 'repeated'

/**
 * Watches the WebGL canvas. Phones drop the context when the tab is backgrounded or memory runs short; Cesium cannot
 * resume on its own, so we tell the user and the caller rebuilds the viewer (see CesiumViewer's `recover`).
 * 'repeated' = lost again within a minute of the last recovery, which means the device is really short of memory.
 */
let lastLossAt = 0   // module level: survives the viewer being rebuilt

export function useContextLoss(viewer: Cesium.Viewer | null, onRestoredAuto: () => void): GpuState {
  const [state, setState] = useState<GpuState>('ok')
  const autoRef = useRef(onRestoredAuto)
  autoRef.current = onRestoredAuto

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const canvas = viewer.canvas
    const scene = viewer.scene
    const lost = (e: Event) => {
      e.preventDefault()          // allows the browser to restore the context later
      const now = Date.now()
      setState(now - lastLossAt < 60_000 ? 'repeated' : 'lost')
      lastLossAt = now
    }
    const restored = () => { setState((s) => { if (s === 'lost') queueMicrotask(() => autoRef.current()); return s }) }
    const renderError = () => { setState((s) => (s === 'ok' ? 'lost' : s)) }
    canvas.addEventListener('webglcontextlost', lost as EventListener)
    canvas.addEventListener('webglcontextrestored', restored)
    const rm = scene.renderError.addEventListener(renderError)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost as EventListener)
      canvas.removeEventListener('webglcontextrestored', restored)
      rm()
    }
  }, [viewer])

  return state
}
