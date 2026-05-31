import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import type { GeoPoint } from '@/lib/geopoints'

const PIN = new Cesium.Color(1.0, 0.55, 0.0, 1.0)   // orange

function pickPos(v: Cesium.Viewer, win: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
  const pos = v.scene.pickPosition(win)
  if (Cesium.defined(pos) && !isNaN(pos.x)) return pos
  const ray = v.camera.getPickRay(win, new Cesium.Ray())
  if (!ray) return undefined
  return v.scene.globe.pick(ray, v.scene) ?? undefined
}

// Capture a cropped thumbnail around the click point from the Cesium canvas.
// Requires preserveDrawingBuffer: true on the viewer (set in CesiumViewer.tsx).
function captureThumbnail(canvas: HTMLCanvasElement, cx: number, cy: number): string {
  try {
    const THUMB_W = 320, THUMB_H = 200
    const CROP_W  = 640, CROP_H  = 400
    const thumb = document.createElement('canvas')
    thumb.width  = THUMB_W
    thumb.height = THUMB_H
    const ctx = thumb.getContext('2d')
    if (!ctx) return ''
    const sx = Math.max(0, Math.min(Math.round(cx - CROP_W / 2), canvas.width  - CROP_W))
    const sy = Math.max(0, Math.min(Math.round(cy - CROP_H / 2), canvas.height - CROP_H))
    ctx.drawImage(canvas, sx, sy, CROP_W, CROP_H, 0, 0, THUMB_W, THUMB_H)
    return thumb.toDataURL('image/jpeg', 0.82)
  } catch {
    return ''
  }
}

/**
 * Manages geopoint pin entities in a Cesium viewer.
 * When `active`, LEFT_CLICK adds a point via `onAdd` with a canvas thumbnail.
 * Entities are synced with the `points` array (add / remove on diff).
 */
export function useGeopoints(
  viewer: Cesium.Viewer | null,
  active: boolean,
  points: GeoPoint[],
  onAdd: (pt: GeoPoint) => void,
): void {
  const entityMap = useRef<Map<string, Cesium.Entity>>(new Map())
  const onAddRef  = useRef(onAdd)
  const pointsRef = useRef(points)
  onAddRef.current  = onAdd
  pointsRef.current = points

  // ── Sync entities ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewer) return
    const map = entityMap.current
    const ids  = new Set(points.map((p) => p.id))

    for (const [id, entity] of map) {
      if (!ids.has(id)) {
        viewer.entities.remove(entity)
        map.delete(id)
      }
    }

    for (const pt of points) {
      if (map.has(pt.id)) continue
      const pos = Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt)
      const entity = viewer.entities.add({
        position: pos,
        point: {
          pixelSize: 11,
          color: PIN,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: pt.label,
          font: '11px ui-sans-serif, system-ui, sans-serif',
          style: Cesium.LabelStyle.FILL,
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: new Cesium.Color(0, 0, 0, 0.65),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      map.set(pt.id, entity)
    }
  }, [viewer, points])

  // ── Cleanup on viewer swap ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (!viewer || viewer.isDestroyed()) return
      for (const entity of entityMap.current.values()) viewer.entities.remove(entity)
      entityMap.current.clear()
    }
  }, [viewer])

  // ── Click handler ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewer || !active) return
    const v = viewer
    const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas)

    handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const pos = pickPos(v, e.position)
      if (!pos) return
      const cart  = Cesium.Cartographic.fromCartesian(pos)
      const next  = pointsRef.current.length + 1
      const thumbnail = captureThumbnail(v.scene.canvas, e.position.x, e.position.y)
      onAddRef.current({
        id:    crypto.randomUUID(),
        lat:   Cesium.Math.toDegrees(cart.latitude),
        lon:   Cesium.Math.toDegrees(cart.longitude),
        alt:   Math.round(cart.height * 100) / 100,
        label: `P${next}`,
        note:  '',
        thumbnail,
      })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => handler.destroy()
  }, [viewer, active])
}
