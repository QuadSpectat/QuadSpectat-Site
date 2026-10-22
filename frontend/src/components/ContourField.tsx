import { useEffect, useRef } from 'react'

/**
 * Animated topographic contour lines (marching squares over drifting value noise) that bend around the pointer.
 * Decorative only: aria-hidden, pointer-events none, and it draws a single still frame when the visitor
 * prefers reduced motion.
 */
const hash = (x: number, y: number) => {
  let n = x * 374761393 + y * 668265263
  n = (n ^ (n >> 13)) * 1274126177
  return ((n ^ (n >> 16)) >>> 0) / 4294967295
}
const vnoise = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  return hash(xi, yi) * (1 - u) * (1 - v) + hash(xi + 1, yi) * u * (1 - v) + hash(xi, yi + 1) * (1 - u) * v + hash(xi + 1, yi + 1) * u * v
}
const fbm = (x: number, y: number) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15

// marching-squares edge table: corner bits (a=TL 8, b=TR 4, c=BR 2, d=BL 1) -> edge pairs (0 top, 1 right, 2 bottom, 3 left)
const EDGE: number[][][] = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[3, 0]],
  [[3, 0]], [[0, 2]], [[3, 2], [0, 1]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], [],
]

export function ContourField({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const cell = 18
    let W = 0, H = 0, cols = 0, rows = 0, vals = new Float32Array(0), last = 0, mx = -1, my = -1, raf = 0

    const size = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 1.5)
      W = r.width; H = r.height
      cv.width = Math.max(1, W * d); cv.height = Math.max(1, H * d)
      ctx.setTransform(d, 0, 0, d, 0, 0)
      cols = Math.ceil(W / cell) + 2; rows = Math.ceil(H / cell) + 2
      vals = new Float32Array(cols * rows)
    }

    const draw = (ts: number) => {
      const t = ts / 1000
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        let v = fbm(i * 0.04 + t * 0.035, j * 0.04 - t * 0.025)
        if (mx >= 0) { const dx = i * cell - mx, dy = j * cell - my; v += 0.22 * Math.exp(-(dx * dx + dy * dy) / 26000) }
        vals[j * cols + i] = v
      }
      ctx.clearRect(0, 0, W, H)
      for (let L = 0; L < 14; L++) {
        const lv = 0.24 + L * 0.035, index = L % 5 === 0
        ctx.beginPath()
        for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
          const a = vals[j * cols + i], b = vals[j * cols + i + 1], c = vals[(j + 1) * cols + i + 1], d = vals[(j + 1) * cols + i]
          const k = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0)
          const segs = EDGE[k]
          if (!segs.length) continue
          const x0 = i * cell, y0 = j * cell
          const pt = (e: number): [number, number] =>
            e === 0 ? [x0 + cell * ((lv - a) / (b - a)), y0]
              : e === 1 ? [x0 + cell, y0 + cell * ((lv - b) / (c - b))]
                : e === 2 ? [x0 + cell * ((lv - d) / (c - d)), y0 + cell]
                  : [x0, y0 + cell * ((lv - a) / (d - a))]
          for (const [e1, e2] of segs) { const p = pt(e1), q = pt(e2); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]) }
        }
        ctx.strokeStyle = `rgba(154,205,60,${index ? 0.5 : 0.22})`
        ctx.lineWidth = index ? 1.4 : 0.8
        ctx.stroke()
      }
    }
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick)
      if (ts - last < 40) return
      last = ts
      draw(ts)
    }
    const resize = () => { size(); draw(performance.now()) }
    const onMove = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top }

    size(); draw(performance.now())
    const ro = new ResizeObserver(resize); ro.observe(cv)
    if (!reduced) { raf = requestAnimationFrame(tick); window.addEventListener('pointermove', onMove) }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('pointermove', onMove) }
  }, [])

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none ${className}`} />
}
