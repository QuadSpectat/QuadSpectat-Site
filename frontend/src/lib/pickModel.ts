/**
 * Picking that never touches Google's tiles. While Google 3D is shown, measuring tools pick against the owner's model only:
 * the pick ray is cast through everything and only a hit on the owner's model counts, so a Google surface in front of the model is
 * ignored (Google's content terms do not allow taking measurements from Google data). Without anything to exclude the normal depth
 * pick is used.
 */
import * as Cesium from 'cesium'

export function pickModelPosition(v: Cesium.Viewer, win: Cesium.Cartesian2, exclude: object[]): Cesium.Cartesian3 | undefined {
  if (exclude.length === 0) {
    const pos = v.scene.pickPosition(win)
    if (Cesium.defined(pos) && !isNaN(pos.x)) return pos
    const ray = v.camera.getPickRay(win, new Cesium.Ray())
    if (!ray) return undefined
    return v.scene.globe.pick(ray, v.scene) ?? undefined
  }
  // Cast the pick ray through everything it meets (nearest first) and take the first hit that is the owner's model: hits on an
  // excluded tileset (Google), and on pins / layer shapes, are skipped, so a Google surface in front of the model is ignored.
  const ray = v.camera.getPickRay(win, new Cesium.Ray())
  if (!ray) return undefined
  const sc = v.scene as unknown as { drillPickFromRay: (r: Cesium.Ray, limit?: number) => { object?: { content?: { tileset?: object }; primitive?: object; id?: unknown }; position?: Cesium.Cartesian3 }[] }
  for (const hit of sc.drillPickFromRay(ray, 12)) {
    const o = hit.object
    if (!o || !hit.position || isNaN(hit.position.x)) continue
    if (o.content?.tileset && exclude.includes(o.content.tileset)) continue
    if (o.primitive && exclude.includes(o.primitive)) continue
    if (o.id instanceof Cesium.Entity && !o.id.model) continue
    return hit.position
  }
  return undefined
}
