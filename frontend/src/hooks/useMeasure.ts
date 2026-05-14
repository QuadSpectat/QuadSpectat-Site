import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import {
  type MeasureMode,
  centroid, computeDistance, computeArea, computeVolume,
  formatDistance, formatArea, formatVolume,
} from '@/lib/measure'

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
): void {
  // Keep onResult stable so the effect deps stay tight
  const onResultRef = useRef(onResult)
  useEffect(() => { onResultRef.current = onResult })

  useEffect(() => {
    if (!viewer || mode === 'none') {
      onResultRef.current(null)
      return
    }

    // Narrow to non-null for use inside closures
    const v = viewer
    const points: Cesium.Cartesian3[] = []
    let hover: Cesium.Cartesian3 | null = null
    let finished = false

    // All entities created in this session — cleaned up on exit
    const allEntities: Cesium.Entity[] = []
    // Per-point stacks — used for right-click undo
    const dotStack: Cesium.Entity[] = []
    const segLabelStack: Cesium.Entity[] = []

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
      const pos = v.scene.pickPosition(win)
      if (Cesium.defined(pos) && !isNaN(pos.x)) return pos
      const ray = v.camera.getPickRay(win, new Cesium.Ray())
      if (!ray) return undefined
      return v.scene.globe.pick(ray, v.scene) ?? undefined
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
              return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, baseElevation)
            })
            return new Cesium.PolygonHierarchy(basePts)
          }, false),
          show: new Cesium.CallbackProperty(() => points.length >= 3, false),
          material: new Cesium.ColorMaterialProperty(BASE),
          height: baseElevation,
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

    function finish() {
      if (finished) return
      const minPts = mode === 'distance' ? 2 : 3
      if (points.length < minPts) return

      finished = true

      let text: string
      if (mode === 'distance') {
        text = `Total: ${formatDistance(computeDistance(points))}`
      } else if (mode === 'area') {
        text = `Area: ${formatArea(computeArea(points))}`
      } else {
        text = `Volume: ${formatVolume(computeVolume(points, baseElevation))}`
      }

      onResultRef.current(text)

      const center = mode === 'distance'
        ? Cesium.Cartesian3.midpoint(points[0], points[points.length - 1], new Cesium.Cartesian3())
        : centroid(points)

      addEnt({ position: center, label: labelOpts(text, true) })
    }

    // ── ScreenSpaceEventHandler ───────────────────────────────────────────
    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (finished) return
      const pos = pick(e.position)
      if (!pos) return
      points.push(pos)
      addDot(pos)
      refreshSegLabels()
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (finished) return
      hover = pick(e.endPosition) ?? null
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    handler.setInputAction((_e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (finished) return
      // LEFT_DOUBLE_CLICK fires after 2× LEFT_CLICK — remove the duplicate last point
      if (points.length > 0) {
        points.pop()
        const dot = dotStack.pop()
        if (dot) removeTracked(dot)
      }
      refreshSegLabels()
      finish()
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    handler.setInputAction((_e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (finished || points.length === 0) return
      points.pop()
      const dot = dotStack.pop()
      if (dot) removeTracked(dot)
      refreshSegLabels()
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK)

    // ── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      handler.destroy()
      if (!v.isDestroyed()) {
        for (const e of allEntities) v.entities.remove(e)
      }
      onResultRef.current(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, mode, baseElevation, measureKey])
}
