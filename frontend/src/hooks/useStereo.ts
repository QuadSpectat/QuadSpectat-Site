import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { detectDevice } from '@/lib/deviceProfile'
import { ANAGLYPH_SHADER, bi, createFrameGuard, eyeSeparation, focusDistance, getStereo, setStereo, useStereoState } from '@/lib/anaglyph'

interface Options {
  /** Bounding sphere of the open model (null until it is ready); sets focus distance and separation */
  sphereRef: React.MutableRefObject<Cesium.BoundingSphere | null>
  /** A measure / profile / geopoint tool is active: pickPosition does not work in side-by-side, so 3D waits */
  toolActive: boolean
  googleShown: boolean
  hasModel: boolean
  /** An orthophoto or base map is visible (they render flat) */
  flatMap: boolean
  onNotice: (msg: string) => void
}

/** Cesium's own debug fields we have to reach (not in the typings). */
type PickFn = (pos: Cesium.Cartesian2, result?: Cesium.Cartesian3) => Cesium.Cartesian3 | undefined
type SceneInternals = Omit<Cesium.Scene, 'pickPosition'> & { _deviceOrientationCameraController?: { destroy(): void }; _aspectRatioVR?: number; _useWebVR?: boolean; pickPositionWorldCoordinates?: PickFn; pickPosition?: PickFn }

/**
 * Turns red/cyan 3D on for one viewer and returns the function that restores normal rendering.
 * Cesium's useWebVR draws the left eye into the left half of the canvas and the right eye into the right half; one post
 * stage then merges the halves into a single red/cyan image.
 */
function startStereo(v: Cesium.Viewer, sphereRef: Options['sphereRef'], phone: boolean, onGuard: (r: 'reduce' | 'off') => void): () => void {
  const scene = v.scene as SceneInternals
  const camera = scene.camera
  scene.useWebVR = true
  // The phone gyroscope controller that useWebVR creates would turn the camera by itself: remove it right away.
  scene._deviceOrientationCameraController?.destroy()
  scene._deviceOrientationCameraController = undefined

  // Each eye is rendered into a half-width viewport and Cesium sets the frustum aspect to HALF the canvas aspect, so the
  // eye would see a different field of view and the stage's 2x stretch would distort it. While rendering, store twice
  // the value Cesium writes: the frustum then equals the normal one, and the stretch is exact. Cesium replaces
  // camera.frustum with a plain clone at the end of every frame, so the accessor is installed again before each frame.
  const squeeze = (f: Cesium.PerspectiveFrustum) => {
    if (Object.getOwnPropertyDescriptor(f, 'aspectRatio')?.get) return
    let a = f.aspectRatio as number
    Object.defineProperty(f, 'aspectRatio', { configurable: true, enumerable: true, get: () => a, set: (x: number) => { a = x * 2 } })
  }

  // Depth picking (Cesium's zoom and orbit read the depth under the cursor and at the screen centre; layer click reads the
  // clicked point) uses a depth buffer that holds both eyes, so it returns nonsense. Instead, when a gesture starts (pointer
  // down, or wheel at a new spot) one flat frame is rendered and both points are read from it and kept while the gesture
  // continues (renewed every 250 ms while zooming; dropped 1.5 s after the last event); Cesium's picking functions answer from those points only.
  // Measuring never relies on this: it pauses 3D (see useStereo).
  const basePick = (Cesium.Scene.prototype as unknown as { pickPositionWorldCoordinates: PickFn }).pickPositionWorldCoordinates
  let held: { t: number; seen: number; pts: { x: number; y: number; hit?: Cesium.Cartesian3 }[] } | null = null
  const heldPt = (x: number, y: number) => (held && performance.now() - held.seen < 1500 ? held.pts.find((q) => Math.hypot(q.x - x, q.y - y) < 4) : undefined)
  const pickHeld: PickFn = (pos, result) => { const q = heldPt(pos.x, pos.y); return q?.hit ? Cesium.Cartesian3.clone(q.hit, result) : undefined }
  scene.pickPositionWorldCoordinates = pickHeld
  scene.pickPosition = pickHeld
  let flat = false
  let stage: Cesium.PostProcessStage | Cesium.PostProcessStageComposite
  const holdPoint = (e: MouseEvent) => {
    const r = v.canvas.getBoundingClientRect()
    const x = e.clientX - r.left, y = e.clientY - r.top
    const now = performance.now()
    if (e.type === 'wheel' && heldPt(x, y) && now - held!.t < 250) { held!.seen = now; return }   // the zoom changes the depth: read it again every 250 ms
    flat = true; stage.enabled = false; scene._useWebVR = false   // the flag only: no controllers or frustum are touched
    try {
      scene.requestRender(); scene.render()
      held = { t: performance.now(), seen: performance.now(), pts: [[x, y], [v.canvas.clientWidth / 2, v.canvas.clientHeight / 2]].map(([px, py]) => ({ x: px, y: py, hit: basePick.call(scene, new Cesium.Cartesian2(px, py)) })) }
    } finally { scene._useWebVR = true; stage.enabled = true; flat = false }
    scene.requestRender()
  }
  v.canvas.addEventListener('pointerdown', holdPoint, true)
  v.canvas.addEventListener('wheel', holdPoint, { capture: true, passive: true })

  let shift = 0   // each eye is moved sideways by this fraction of the screen width (see ANAGLYPH_SHADER)
  stage = scene.postProcessStages.add(new Cesium.PostProcessStage({
    fragmentShader: ANAGLYPH_SHADER,
    sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
    uniforms: {
      u_px: () => new Cesium.Cartesian2(1 / scene.drawingBufferWidth, 1 / scene.drawingBufferHeight),
      u_shift: () => shift,
      u_swap: () => (getStereo().swap ? 1 : 0),
      u_comfort: () => (getStereo().comfort ? 1 : 0),
      u_ghost: () => getStereo().ghost,
    },
  }))

  // Focus distance and eye separation follow the camera, smoothed (about 150 ms) so zooming does not make the depth jump.
  let cur: { D: number; e: number } | null = null
  let last = performance.now()
  let lastSphere: Cesium.BoundingSphere | null = null
  const onPreRender = () => {
    squeeze(camera.frustum as Cesium.PerspectiveFrustum)
    const now = performance.now(), dt = now - last
    last = now
    const sph = sphereRef.current
    if (!sph) return
    const dist = Cesium.Cartesian3.distance(camera.positionWC, sph.center)
    const D = focusDistance(dist, sph.radius, getStereo().pop)
    const e = eyeSeparation(D, dist, sph.radius, getStereo())
    if (!cur || sph !== lastSphere) cur = { D, e }   // first frame or a new model: no easing
    else {
      const k = 1 - Math.exp(-dt / 150)
      cur = { D: cur.D + (D - cur.D) * k, e: cur.e + (e - cur.e) * k }
      if (Math.abs(cur.D - D) > 0.01 * D || Math.abs(cur.e - e) > 0.01 * Math.max(e, 1e-6)) scene.requestRender()
    }
    lastSphere = sph
    // Eye separation e moves the two cameras. Convergence at D is a screen shift of e/D x focal length (in pixels), split over
    // both eyes; focalLength is made huge so that Cesium's own (lost or not) offset stays zero whatever its version does.
    scene.eyeSeparation = cur.e
    scene.focalLength = 1e9
    shift = (cur.e / cur.D) * 0.25 * camera.frustum.projectionMatrix[0]
  }
  scene.preRender.addEventListener(onPreRender)

  // Phones: if frames stay slow while the camera moves, reduce detail once, then switch 3D off.
  const guard = createFrameGuard()
  let prev = 0
  const onPostRender = () => {
    const now = performance.now(), dt = now - prev
    prev = now
    if (flat || !phone || dt >= 1000) return
    const r = guard.push(dt, now)
    if (r !== 'ok') onGuard(r)
  }
  scene.postRender.addEventListener(onPostRender)
  scene.requestRender()

  return () => {
    if (v.isDestroyed()) return
    scene.preRender.removeEventListener(onPreRender)
    scene.postRender.removeEventListener(onPostRender)
    scene.postProcessStages.remove(stage)
    v.canvas.removeEventListener('pointerdown', holdPoint, true)
    v.canvas.removeEventListener('wheel', holdPoint, true)
    delete scene.pickPositionWorldCoordinates
    delete scene.pickPosition
    scene.focalLength = undefined as unknown as number   // Cesium's defaults again
    scene.eyeSeparation = undefined as unknown as number
    // Cesium restores the saved aspect ratio on exit; the canvas may have been resized since, so refresh what it saved.
    scene._aspectRatioVR = v.canvas.clientWidth / Math.max(1, v.canvas.clientHeight)
    const f = camera.frustum as Cesium.PerspectiveFrustum
    if (Object.getOwnPropertyDescriptor(f, 'aspectRatio')?.get) { const a = f.aspectRatio; delete (f as { aspectRatio?: number }).aspectRatio; f.aspectRatio = a }
    scene.useWebVR = false
    scene.requestRender()
  }
}

/**
 * Red/cyan 3D for the viewer: publishes availability to the shared store (the buttons read it), starts and stops the
 * stereo rendering, pauses it while a pointer tool is active and applies the phone rules (SSE x1.3, frame-rate guard).
 */
export function useStereo(viewer: Cesium.Viewer | null, o: Options): void {
  const st = useStereoState()
  const blocked = o.googleShown ? 'google' : !o.hasModel ? 'nomodel' : null
  const phone = detectDevice().phone
  const active = st.on && !blocked && !o.toolActive
  const paused = st.on && !blocked && o.toolActive
  const noticeRef = useRef(o.onNotice)
  noticeRef.current = o.onNotice

  useEffect(() => {
    setStereo({ blocked, flatMap: o.flatMap })
    if (blocked === 'google' && getStereo().on) { setStereo({ on: false }); noticeRef.current(bi('googleOff')) }
  }, [blocked, o.flatMap])

  // Pause / resume with a short note (not on the first render)
  const wasPaused = useRef(false)
  useEffect(() => {
    setStereo({ paused })
    if (paused !== wasPaused.current) noticeRef.current(bi(paused ? 'pausedMeasure' : 'resumed'))
    wasPaused.current = paused
  }, [paused])

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !active) return
    setStereo({ boost: phone ? 1.3 : 1 })
    const stop = startStereo(viewer, o.sphereRef, phone, (r) => {
      if (r === 'reduce') { setStereo({ boost: 1.3 * 1.5 }); noticeRef.current(bi('slow')) }
      else { setStereo({ on: false }); noticeRef.current(bi('tooSlow')) }
    })
    return () => { stop(); setStereo({ boost: 1 }) }
  }, [viewer, active])

  // Key H hides / shows every menu while 3D is on (not while typing)
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'h' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      setStereo({ hideMenus: !getStereo().hideMenus })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  // Menus come back when 3D goes off
  useEffect(() => { if (!st.on && getStereo().hideMenus) setStereo({ hideMenus: false }) }, [st.on])

  // The viewer is gone (page change or reload): the next one starts flat
  useEffect(() => () => { setStereo({ on: false, blocked: null, paused: false, flatMap: false, boost: 1, hideMenus: false }) }, [])
}
