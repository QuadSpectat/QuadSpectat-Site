import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'

interface Props {
  viewer: Cesium.Viewer | null
  onHome?: () => void
}

const BTN = 'flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.15] bg-[#0b100d]/[0.97] ' +
  'backdrop-blur-xl shadow-2xl shadow-black/80 text-white/80 hover:text-white transition-colors'

const SCALE_PX = 120
const PROBE_PX = 100

function niceLength(maxMetres: number): number {
  if (!(maxMetres > 0)) return 0
  const pow = Math.pow(10, Math.floor(Math.log10(maxMetres)))
  for (const m of [5, 2, 1]) {
    if (m * pow <= maxMetres) return m * pow
  }
  return pow
}

function formatLength(m: number): string {
  if (m >= 1000) return `${+(m / 1000).toPrecision(3)} km`
  if (m >= 1) return `${+m.toPrecision(3)} m`
  return `${Math.round(m * 100)} cm`
}

function pickWorld(v: Cesium.Viewer, x: number, y: number): Cesium.Cartesian3 | undefined {
  const pos = new Cesium.Cartesian2(x, y)
  const scene = v.scene
  let p: Cesium.Cartesian3 | undefined
  if (scene.pickPositionSupported) {
    p = scene.pickPosition(pos)
  }
  if (!Cesium.defined(p)) {
    const ray = v.camera.getPickRay(pos)
    if (ray) p = scene.globe.pick(ray, scene)
  }
  return p
}

export function OrientationAids({ viewer, onHome }: Props) {
  const arrowRef = useRef<SVGSVGElement>(null)
  const [scale, setScale] = useState<{ px: number; label: string } | null>(null)

  // Compass rotation + scale bar
  useEffect(() => {
    if (!viewer) return
    const v = viewer
    let raf = 0
    let lastScale = 0
    let lastKey = ''

    function updateCompass() {
      raf = 0
      if (v.isDestroyed()) return
      if (arrowRef.current) {
        arrowRef.current.style.transform = `rotate(${-Cesium.Math.toDegrees(v.camera.heading)}deg)`
      }
    }
    function onPostRender() {
      if (!raf) raf = requestAnimationFrame(updateCompass)
    }

    function updateScale() {
      if (v.isDestroyed()) return
      const canvas = v.canvas
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      let next: { px: number; label: string } | null = null
      try {
        if (w > PROBE_PX * 2 && h > 100) {
          const y = h * 0.85
          const a = pickWorld(v, w / 2 - PROBE_PX / 2, y)
          const b = pickWorld(v, w / 2 + PROBE_PX / 2, y)
          if (a && b) {
            const mpp = Cesium.Cartesian3.distance(a, b) / PROBE_PX
            const len = niceLength(mpp * SCALE_PX)
            if (mpp > 0 && len > 0 && isFinite(len)) {
              next = { px: Math.max(8, Math.round(len / mpp)), label: formatLength(len) }
            }
          }
        }
      } catch {
        next = null
      }
      const key = next ? `${next.px}|${next.label}` : ''
      if (key !== lastKey) {
        lastKey = key
        setScale(next)
      }
    }
    function onChanged() {
      const now = performance.now()
      if (now - lastScale > 100) { lastScale = now; updateScale() }
    }

    v.scene.postRender.addEventListener(onPostRender)
    v.camera.changed.addEventListener(onChanged)
    const timer = window.setInterval(updateScale, 250)
    updateCompass()
    updateScale()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.clearInterval(timer)
      if (!v.isDestroyed()) {
        v.scene.postRender.removeEventListener(onPostRender)
        v.camera.changed.removeEventListener(onChanged)
      }
    }
  }, [viewer])

  const resetNorth = () => {
    if (!viewer || viewer.isDestroyed()) return
    const c = viewer.camera
    c.flyTo({
      destination: c.position.clone(),
      orientation: { heading: 0, pitch: c.pitch, roll: 0 },
      duration: 0.6,
    })
  }

  const zoom = (dir: 1 | -1) => {
    if (!viewer || viewer.isDestroyed()) return
    const c = viewer.camera
    let h = c.positionCartographic.height
    try {
      const g = viewer.scene.globe.getHeight(c.positionCartographic)
      if (g !== undefined) h -= g
    } catch { /* ignore */ }
    const amount = Math.max(3, Math.abs(h) * 0.4)
    if (dir > 0) c.zoomIn(amount)
    else c.zoomOut(amount)
  }

  return (
    <>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-2">
        <button type="button" onClick={resetNorth} aria-label="Reset to north" title="Reset to north" className={BTN}>
          <svg ref={arrowRef} width="24" height="24" viewBox="0 0 24 24" style={{ transition: 'transform 80ms linear' }}>
            <path d="M12 2 L17 13 L12 11 L7 13 Z" fill="#ef4444" />
            <path d="M12 22 L17 13 L12 11 L7 13 Z" fill="currentColor" opacity="0.55" />
          </svg>
        </button>
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in" title="Zoom in" className={BTN}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M10 3v14M3 10h14" />
          </svg>
        </button>
        <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out" title="Zoom out" className={BTN}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 10h14" />
          </svg>
        </button>
        {onHome && (
          <button type="button" onClick={onHome} aria-label="Home view" title="Home view" className={BTN}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
              <path d="M3 9.5 10 3l7 6.5M5 8.5V16h10V8.5" />
            </svg>
          </button>
        )}
      </div>

      {scale && (
        <div className="absolute left-4 bottom-[5.5rem] z-10 pointer-events-none rounded-lg border border-white/[0.15]
                        bg-[#0b100d]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 px-2.5 pt-1.5 pb-2">
          <div className="font-mono text-[11px] leading-none text-white/80 mb-1"
               style={{ fontVariantNumeric: 'tabular-nums' }}>
            {scale.label}
          </div>
          <div
            className="h-1.5 border-x border-b border-white/80"
            style={{ width: scale.px }}
          />
        </div>
      )}
    </>
  )
}
