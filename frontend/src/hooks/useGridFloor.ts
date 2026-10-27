import { useEffect } from 'react'
import * as Cesium from 'cesium'
import { useStereoState } from '@/lib/anaglyph'
import { createGridFloor, getGrid, useGridState } from '@/lib/gridFloor'

interface Options {
  /** Bounding sphere of the open model (null until it is ready) */
  sphereRef: React.MutableRefObject<Cesium.BoundingSphere | null>
  tilesetRef: React.MutableRefObject<Cesium.Cesium3DTileset | null>
  entityRef: React.MutableRefObject<Cesium.Entity | null>
  hasModel: boolean
  modelId?: string
  googleShown: boolean
}

/** Lowest point of the model, ellipsoidal height: bottom of a tileset's box, the entity altitude of a GLB (its lowest point sits there). */
function baseHeight(v: Cesium.Viewer, o: Options, sph: Cesium.BoundingSphere, tmp: Cesium.Cartographic): number {
  const ts = o.tilesetRef.current
  if (ts) {
    const bv = (ts.root as unknown as { boundingVolume?: { boundingVolume?: Cesium.OrientedBoundingBox | Cesium.BoundingSphere } } | undefined)?.boundingVolume?.boundingVolume
    if (bv && 'halfAxes' in bv) {
      const ha = bv.halfAxes, c = bv.center
      let lo = Infinity
      for (let i = 0; i < 8; i++) {
        const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1, sz = i & 4 ? 1 : -1
        const p = new Cesium.Cartesian3(
          c.x + sx * ha[0] + sy * ha[3] + sz * ha[6],
          c.y + sx * ha[1] + sy * ha[4] + sz * ha[7],
          c.z + sx * ha[2] + sy * ha[5] + sz * ha[8])
        lo = Math.min(lo, Cesium.Cartographic.fromCartesian(p, undefined, tmp).height)
      }
      if (Number.isFinite(lo)) return lo
    }
  } else {
    const pos = o.entityRef.current?.position?.getValue(v.clock.currentTime)
    if (pos) return Cesium.Cartographic.fromCartesian(pos, undefined, tmp).height
  }
  return Cesium.Cartographic.fromCartesian(sph.center, undefined, tmp).height - sph.radius * 0.5
}

/**
 * Reference grid (Visual panel, "Grid / רשת"). Indicative scale aid, see lib/gridFloor.ts.
 * Shown only when the user switched it on, no Google 3D is shown, and red/cyan 3D is off (the choice stays "on" and
 * returns when 3D goes off). The base is re-read every frame so the Height Offset slider and a late load move it along.
 */
export function useGridFloor(viewer: Cesium.Viewer | null, o: Options) {
  const g = useGridState()
  const stereoOn = useStereoState().on
  const active = g.on && !stereoOn && !o.googleShown && o.hasModel

  useEffect(() => {
    if (!viewer || !active) return
    const grid = createGridFloor(viewer)
    grid.setColor(getGrid().color)
    const tmp = new Cesium.Cartographic()
    const sync = () => {
      const sph = o.sphereRef.current
      if (!sph) return
      const c = Cesium.Cartographic.fromCartesian(sph.center)
      grid.setAnchor({ lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), h: baseHeight(viewer, o, sph, tmp) + getGrid().height, radius: sph.radius })
    }
    viewer.scene.preUpdate.addEventListener(sync)
    viewer.scene.requestRender()
    return () => { viewer.scene.preUpdate.removeEventListener(sync); grid.destroy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, active, o.modelId, g.color])   // a new colour simply rebuilds the (tiny) grid

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    viewer.scene.requestRender()   // height changed: draw one frame (the anchor is re-read before every frame)
  }, [viewer, g.height])
}
