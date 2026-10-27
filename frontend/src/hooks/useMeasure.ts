import { fromMsl, DEFAULT_HEIGHT_REF } from '@/lib/heights'
import type { HeightRef } from '@/lib/heights'
import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import {
  type MeasureMode,
  centroid, computeDistance, computeArea, computeVolume,
  formatDistance, formatArea, formatVolume,
} from '@/lib/measure'
import { toMsl } from '@/lib/heights'
import { pickModelPosition } from '@/lib/pickModel'
import {
  type Profile, horizontalDistance, lineStations, profileStats, sampleCount,
} from '@/lib/profile'

// ── Palette ───────────────────────────────────────────────────────────────────
const LINE   = new Cesium.Color(1.00, 0.84, 0.00, 1.00)  // gold
const FILL   = new Cesium.Color(1.00, 0.84, 0.00, 0.22)
const BASE   = new Cesium.Color(0.00, 0.74, 0.83, 0.22)  // cyan (volume base plane)

// ── Label helper ──────────────────────────────────────────────────────────────
function labelOpts(text: string, large = false): Cesium.LabelGraphics.ConstructorOptions {
  return {
    text,
    font: `${large ? 14 : 12}px ui-sans-serif, system-ui, sans-serif`,
    style: Cesium.LabelStyle.FILL,
    fillColor: Cesium.Color.WHITE,
    showBackground: true,
    backgroundColor: new Cesium.Color(0, 0, 0, large ? 0.72 : 0.52),
    backgroundPadding: new Cesium.Cartesian2(large ? 8 : 6, large ? 5 : 3),
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    pixelOffset: new Cesium.Cartesian2(0, -6),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  }
}

/** True when a 3D Tiles model is in the scene (a glTF model is an entity and is looked up separately). */
function tilesetOpen(v: Cesium.Viewer): boolean {
  const prims = v.scene.primitives
  for (let i = 0; i < prims.length; i++) if (prims.get(i) instanceof Cesium.Cesium3DTileset) return true
  return false
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Attaches measuring tools to an existing Cesium Viewer.
 * Re-mounts whenever `viewer`, `mode`, `baseElevation`, or `measureKey` change.
 * `measureKey` can be bumped to restart the current mode without changing it.
 */
export function useMeasure(
  viewer: Cesium.Viewer | null,
  mode: MeasureMode,
  baseElevation: number,
  measureKey: number,
  onResult: (text: string | null) => void,
  heightRef?: { current: HeightRef },
  extras?: {
    undoRef?: React.MutableRefObject<(() => void) | null>
    /** Written with a function that puts back the point the last Undo took away. */
    redoRef?: React.MutableRefObject<(() => void) | null>
    /** Written with a function that completes the measurement (the touch "Finish" button). */
    finishRef?: React.MutableRefObject<(() => void) | null>
    onNotice?: (msg: string) => void
    /** Objects the picks must ignore (Google's tileset while Google 3D is shown) */
    getExcluded?: () => object[]
    /** Profile mode: called with the sampled profile once ready, and with null when it is cleared. */
    onProfile?: (p: Profile | null) => void
  },
): void {
  // Keep onResult stable so the effect deps stay tight
  const onResultRef = useRef(onResult)
  useEffect(() => { onResultRef.current = onResult })
  const extrasRef = useRef(extras)
  useEffect(() => { extrasRef.current = extras })

  useEffect(() => {
    if (!viewer || mode === 'none') {
      onResultRef.current(null)
      extrasRef.current?.onProfile?.(null)
      return
    }

    // Narrow to non-null for use inside closures
    const v = viewer
    const points: Cesium.Cartesian3[] = []
    let hover: Cesium.Cartesian3 | null = null
    let finished = false
    let lastHoverPick = 0

    // The base elevation the user types is a height ABOVE SEA LEVEL; the scene uses ellipsoidal heights.
    function baseEll(lat: number, lon: number): number {
      return fromMsl(lat, lon, baseElevation, heightRef?.current ?? DEFAULT_HEIGHT_REF)
    }
    function baseEllAt(p: Cesium.Cartesian3): number {
      const c = Cesium.Cartographic.fromCartesian(p)
      return baseEll(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude))
    }

    // All entities created in this session — cleaned up on exit
    const allEntities: Cesium.Entity[] = []
    // Per-point stacks — used for right-click undo
    const dotStack: Cesium.Entity[] = []
    const segLabelStack: Cesium.Entity[] = []
    // Points taken away by Undo, newest last: Redo puts them back. Any new click starts a new history.
    const redoStack: Cesium.Cartesian3[] = []
    let resultLabel: Cesium.Entity | null = null
    let profileRun = 0

    function addEnt(def: Cesium.Entity.ConstructorOptions): Cesium.Entity {
      const e = v.entities.add(def)
      allEntities.push(e)
      return e
    }

    function removeTracked(e: Cesium.Entity) {
      v.entities.remove(e)
      const i = allEntities.indexOf(e)
      if (i >= 0) allEntities.splice(i, 1)
    }

    // ── Pick helper ────────────────────────────────────────────────────────
    function pick(win: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
      return pickModelPosition(v, win, extrasRef.current?.getExcluded?.() ?? [])
    }

    // ── Dynamic (CallbackProperty) entities ───────────────────────────────

    // Completed segments
    addEnt({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (points.length === 0) return []
          if ((mode === 'area' || mode === 'volume') && finished && points.length >= 3) {
            return [...points, points[0]]
          }
          return [...points]
        }, false),
        width: 3,
        material: new Cesium.ColorMaterialProperty(LINE),
        depthFailMaterial: new Cesium.ColorMaterialProperty(LINE.withAlpha(0.90)),
      },
    })

    // Rubber-band: last point → hover
    addEnt({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (points.length === 0 || !hover || finished) return []
          return [points[points.length - 1], hover]
        }, false),
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: LINE.withAlpha(0.7),
          gapColor: Cesium.Color.TRANSPARENT,
          dashLength: 16,
        }),
        depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
          color: LINE.withAlpha(0.7),
          gapColor: Cesium.Color.TRANSPARENT,
          dashLength: 16,
        }),
      },
    })

    if (mode === 'area' || mode === 'volume') {
      // Dashed closing line: last point → first point (while drawing)
      addEnt({
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            if (points.length < 2 || finished) return []
            return [points[points.length - 1], points[0]]
          }, false),
          width: 1.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: LINE.withAlpha(0.35),
            gapColor: Cesium.Color.TRANSPARENT,
            dashLength: 12,
          }),
        },
      })

      // Polygon fill at terrain height
      addEnt({
        polygon: {
          hierarchy: new Cesium.CallbackProperty(
            () => new Cesium.PolygonHierarchy([...points]),
            false,
          ),
          show: new Cesium.CallbackProperty(() => points.length >= 3, false),
          material: new Cesium.ColorMaterialProperty(FILL),
          perPositionHeight: true,
          outline: false,
        },
      })
    }

    if (mode === 'volume') {
      // Flat base-elevation plane — helps users visualise the reference
      addEnt({
        polygon: {
          hierarchy: new Cesium.CallbackProperty(() => {
            if (points.length < 3) return new Cesium.PolygonHierarchy([])
            const basePts = points.map((p) => {
              const c = Cesium.Cartographic.fromCartesian(p)
              return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, baseEllAt(points[0]))
            })
            return new Cesium.PolygonHierarchy(basePts)
          }, false),
          show: new Cesium.CallbackProperty(() => points.length >= 3, false),
          material: new Cesium.ColorMaterialProperty(BASE),
          height: new Cesium.CallbackProperty(() => (points.length ? baseEllAt(points[0]) : 0), false),
          outline: true,
          outlineColor: BASE.withAlpha(0.9),
        },
      })
    }

    // ── Per-click helpers ─────────────────────────────────────────────────

    function addDot(pos: Cesium.Cartesian3) {
      const e = addEnt({
        position: pos,
        point: {
          pixelSize: 8,
          color: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      dotStack.push(e)
    }

    function refreshSegLabels() {
      for (const e of segLabelStack) removeTracked(e)
      segLabelStack.length = 0
      if (mode !== 'distance') return
      for (let i = 1; i < points.length; i++) {
        const mid = Cesium.Cartesian3.midpoint(points[i - 1], points[i], new Cesium.Cartesian3())
        const dist = Cesium.Cartesian3.distance(points[i - 1], points[i])
        const e = addEnt({ position: mid, label: labelOpts(formatDistance(dist)) })
        segLabelStack.push(e)
      }
    }

    // Profile: sample the surface along the line with sampleHeightMostDetailed (works on 3D tiles and terrain).
    // Positions with no surface come back undefined and are kept as gaps, never interpolated.
    let cancelled = false
    // After a failed/empty sampling, drop the second point so the user can pick another end without toggling the tool
    function retryProfile() {
      points.pop()
      const dot = dotStack.pop()
      if (dot) removeTracked(dot)
      finished = false
    }
    async function runProfile() {
      const ref = heightRef?.current ?? DEFAULT_HEIGHT_REF
      const ca = Cesium.Cartographic.fromCartesian(points[0])
      const cb = Cesium.Cartographic.fromCartesian(points[1])
      const a = { lat: Cesium.Math.toDegrees(ca.latitude), lon: Cesium.Math.toDegrees(ca.longitude) }
      const b = { lat: Cesium.Math.toDegrees(cb.latitude), lon: Cesium.Math.toDegrees(cb.longitude) }
      const length = horizontalDistance(a.lat, a.lon, b.lat, b.lon)
      const stations = lineStations(a, b, sampleCount(length))
      const myRun = ++profileRun
      extrasRef.current?.onNotice?.(`Sampling the surface along ${formatDistance(length)}...`)
      let heights: (number | null)[]
      try {
        const carts = stations.map((s) => Cesium.Cartographic.fromDegrees(s.lon, s.lat))
        // Only the model / ground may count as surface: pins, layer lines and measuring shapes of this page are left out
        // (a 100 m KML line used to be read as a 100 m wall), and so are the model-less globe hits below.
        const skip: object[] = [...(extrasRef.current?.getExcluded?.() ?? []), ...v.entities.values.filter((e) => !e.model)]
        for (let i = 0; i < v.dataSources.length; i++) skip.push(...v.dataSources.get(i).entities.values)
        const res = await v.scene.sampleHeightMostDetailed(carts, skip)
        // With a model open, a hit on the bare globe (ellipsoid height, no terrain) means "outside the model": a gap, not a
        // 60 m cliff down to height 0. Without a model the globe is the only surface there is, so it stays.
        const hasModel = v.entities.values.some((e) => !!e.model) || tilesetOpen(v)
        heights = res.map((c, i) => {
          if (!c || !Number.isFinite(c.height)) return null
          if (hasModel && Math.abs(c.height - (v.scene.globe.getHeight(carts[i]) ?? 0)) < 0.01) return null
          return c.height
        })
      } catch {
        if (cancelled || myRun !== profileRun) return
        extrasRef.current?.onNotice?.('Could not sample the surface along this line. Try again.')
        retryProfile()
        return
      }
      if (cancelled || myRun !== profileRun) return
      const samples = stations.map((s, i) => {
        const h = heights[i]
        return { ...s, hEll: h, hMsl: h === null ? null : toMsl(s.lat, s.lon, h, ref) }
      })
      const gaps = samples.filter((s) => s.hMsl === null).length
      const profile: Profile = { samples, length, spacing: length / Math.max(1, samples.length - 1), gaps }
      const st = profileStats(samples)
      if (!st) {
        extrasRef.current?.onNotice?.('No surface found along this line. Draw it over the model or the ground.')
        onResultRef.current(null)
        retryProfile()
        return
      }
      onResultRef.current(
        `Profile: ${formatDistance(length)} · ${st.min.toFixed(1)} to ${st.max.toFixed(1)} m above sea level`,
      )
      extrasRef.current?.onProfile?.(profile)
    }

    function finish() {
      if (finished) return
      if (mode === 'profile') {
        if (points.length < 2) return
        finished = true
        void runProfile()
        return
      }
      const minPts = mode === 'distance' ? 2 : 3
      if (points.length < minPts) return

      finished = true

      let text: string
      if (mode === 'distance') {
        text = `Total: ${formatDistance(computeDistance(points))}`
      } else if (mode === 'area') {
        text = `Area: ${formatArea(computeArea(points))}`
      } else {
        text = `Volume: ${formatVolume(computeVolume(points, baseEllAt(points[0])))} · base ${baseElevation.toFixed(1)} m above sea level`
      }

      onResultRef.current(text)

      const center = mode === 'distance'
        ? Cesium.Cartesian3.midpoint(points[0], points[points.length - 1], new Cesium.Cartesian3())
        : centroid(points)

      // On a two-point distance the total sits exactly on the single segment label: lift it above it
      resultLabel = addEnt({ position: center, label: { ...labelOpts(text, true), pixelOffset: new Cesium.Cartesian2(0, mode === 'distance' ? -32 : -6) } })
    }

    // ── ScreenSpaceEventHandler ───────────────────────────────────────────
    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (finished) return
      const pos = pick(e.position)
      if (!pos) {
        extrasRef.current?.onNotice?.('Nothing to measure here. Click on the model or the ground.')
        return
      }
      if (mode === 'profile' && points.length === 1 &&
          Cesium.Cartesian3.distance(points[0], pos) < 0.1) {
        extrasRef.current?.onNotice?.('That is the same spot. Choose a different second point.')
        return
      }
      points.push(pos)
      redoStack.length = 0
      addDot(pos)
      refreshSegLabels()
      // A profile is exactly one line: it finishes on the second point (also by touch, no double-click needed)
      if (mode === 'profile' && points.length === 2) finish()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (finished) return
      // with Google excluded every pick is two renders: look at the hover only every 80 ms
      if ((extrasRef.current?.getExcluded?.().length ?? 0) > 0) { const t = performance.now(); if (t - lastHoverPick < 80) return; lastHoverPick = t }
      hover = pick(e.endPosition) ?? null
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    handler.setInputAction((_e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (finished || mode === 'profile') return // a profile finishes on its second click
      // LEFT_DOUBLE_CLICK fires after 2× LEFT_CLICK — remove the duplicate last point
      if (points.length > 0) {
        points.pop()
        const dot = dotStack.pop()
        if (dot) removeTracked(dot)
      }
      refreshSegLabels()
      finish()
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    // Undo: remove the last point + its dot, refresh segment labels
    function undoLast() {
      if (finished || points.length === 0) return
      const gone = points.pop()
      if (gone) redoStack.push(gone)
      const dot = dotStack.pop()
      if (dot) removeTracked(dot)
      refreshSegLabels()
    }

    // Redo: the point Undo took away comes back (with its dot and segment label)
    function redoLast() {
      if (finished || redoStack.length === 0) return
      const pos = redoStack.pop()!
      points.push(pos)
      addDot(pos)
      refreshSegLabels()
    }

    // Escape / Delete: throw the measurement away and start again with the same tool
    function cancelMeasurement() {
      profileRun++
      points.length = 0
      hover = null
      finished = false
      redoStack.length = 0
      for (const e of dotStack) removeTracked(e)
      dotStack.length = 0
      refreshSegLabels()
      if (resultLabel) { removeTracked(resultLabel); resultLabel = null }
      onResultRef.current(null)
      extrasRef.current?.onProfile?.(null)
      v.scene.requestRender()
    }

    handler.setInputAction(() => undoLast(), Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    const undoRef = extrasRef.current?.undoRef
    if (undoRef) undoRef.current = undoLast
    const redoRef = extrasRef.current?.redoRef
    if (redoRef) redoRef.current = redoLast
    const finishRef = extrasRef.current?.finishRef
    if (finishRef) finishRef.current = () => {
      if (finished) return
      if (points.length < (mode === 'distance' ? 2 : 3)) {
        extrasRef.current?.onNotice?.(mode === 'distance' ? 'Tap at least two points first.' : 'Tap at least three points first.')
        return
      }
      finish()
    }
    const finishFn = finishRef?.current

    // Keyboard shortcuts (never while typing in a field): Ctrl/Cmd+Z undo, Ctrl+Y or Ctrl+Shift+Z redo, Esc cancel,
    // Enter finish, Delete / Backspace remove the finished measurement (asks first, like the trash button)
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (ev.defaultPrevented || ev.altKey) return
      const mod = ev.ctrlKey || ev.metaKey
      const k = ev.key.toLowerCase()
      if (mod && k === 'z' && !ev.shiftKey) { ev.preventDefault(); undoLast() }
      else if (mod && (k === 'y' || (k === 'z' && ev.shiftKey))) { ev.preventDefault(); redoLast() }
      else if (mod) return
      else if (ev.key === 'Escape') { cancelMeasurement() }
      else if (ev.key === 'Enter') { if (finishFn) { ev.preventDefault(); finishFn() } }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (finished && window.confirm('Delete this measurement?')) { ev.preventDefault(); cancelMeasurement() }
      }
    }
    window.addEventListener('keydown', onKey)

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKey)
      if (undoRef && undoRef.current === undoLast) undoRef.current = null
      if (redoRef && redoRef.current === redoLast) redoRef.current = null
      if (finishRef && finishRef.current === finishFn) finishRef.current = null
      extrasRef.current?.onProfile?.(null)
      handler.destroy()
      if (!v.isDestroyed()) {
        for (const e of allEntities) v.entities.remove(e)
      }
      onResultRef.current(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, mode, baseElevation, measureKey])
}
