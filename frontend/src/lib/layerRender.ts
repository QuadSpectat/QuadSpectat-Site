/**
 * Drawing of overlay layers in the Cesium scene: loading, visibility, vertical offset, feature info.
 * Imported only by the viewer (it needs the Cesium global), never by the panel.
 */
import * as Cesium from 'cesium'

export interface LayerFile { url: string; fileType: string }

/**
 * Loads one layer file as a Cesium data source (not yet added to the viewer).
 * `drape`: lines and areas follow the model/ground (clampToGround). Points are handled by `drapePoints`.
 */
export function loadLayerDataSource(v: Cesium.Viewer, file: LayerFile, drape: boolean): Promise<Cesium.DataSource> {
  const lower = file.url.toLowerCase().split('?')[0]
  if (lower.endsWith('.kml') || lower.endsWith('.kmz') || file.fileType === 'kml' || file.fileType === 'kmz') {
    return Cesium.KmlDataSource.load(file.url, { camera: v.camera, canvas: v.canvas, clampToGround: drape })
  }
  if (lower.endsWith('.czml') || file.fileType === 'czml') return Cesium.CzmlDataSource.load(file.url)
  return Cesium.GeoJsonDataSource.load(file.url, { clampToGround: drape })
}

/** CzmlDataSource.name is getter-only: assigning it throws and used to abort the whole layer. */
export function nameDataSource(ds: Cesium.DataSource, name: string): void {
  try { ds.name = name } catch { /* getter-only data source (CZML): the panel already shows our own name */ }
}

/** Show/hide a data source and its entities (DataSource.show alone is not always enough for KML). */
export function applyVisibility(ds: Cesium.DataSource, visible: boolean): void {
  ds.show = visible
  for (const entity of ds.entities.values) entity.show = visible
}

// ── Vertical offset (file-heights mode only) ─────────────────────────────────

type Prop = Cesium.Property | undefined

/** The loaded state of one entity: the exact Property objects Cesium made, so offset 0 can put them back untouched. */
export interface EntityOrigin {
  rect?: { height: Prop; heightReference: Prop; value: number }
  polygon?: { hierarchy: Prop; height: Prop; heightReference: Prop; perPositionHeight: Prop; extrudedHeight: Prop; hierarchyValue?: Cesium.PolygonHierarchy; heightValue: number; extrudedValue?: number }
  line?: { positions: Prop; clampToGround: Prop; value: Cesium.Cartesian3[] }
  point?: { position: Cesium.PositionProperty | undefined; value: Cesium.Cartesian3; billboardHr: Prop; labelHr: Prop; pointHr: Prop }
}

export function captureOrigins(ds: Cesium.DataSource): Map<string, EntityOrigin> {
  const now = Cesium.JulianDate.now()
  const map = new Map<string, EntityOrigin>()
  for (const e of ds.entities.values) {
    const o: EntityOrigin = {}
    if (e.rectangle) {
      o.rect = { height: e.rectangle.height, heightReference: e.rectangle.heightReference, value: (e.rectangle.height?.getValue(now) as number | undefined) ?? 0 }
    }
    if (e.polygon) {
      const hv = e.polygon.hierarchy?.getValue(now) as Cesium.PolygonHierarchy | Cesium.Cartesian3[] | undefined
      const hierarchyValue = hv && !Array.isArray(hv) ? hv : hv ? new Cesium.PolygonHierarchy(hv) : undefined
      o.polygon = {
        hierarchy: e.polygon.hierarchy, height: e.polygon.height, heightReference: e.polygon.heightReference,
        perPositionHeight: e.polygon.perPositionHeight, extrudedHeight: e.polygon.extrudedHeight,
        hierarchyValue, heightValue: (e.polygon.height?.getValue(now) as number | undefined) ?? 0,
        extrudedValue: e.polygon.extrudedHeight?.getValue(now) as number | undefined,
      }
    }
    if (e.polyline?.positions) {
      const pts = e.polyline.positions.getValue(now) as Cesium.Cartesian3[] | undefined
      if (pts?.length) o.line = { positions: e.polyline.positions, clampToGround: e.polyline.clampToGround, value: pts.map((p) => p.clone()) }
    }
    if (e.position && !e.polyline && !e.polygon) {
      const pos = e.position.getValue(now, new Cesium.Cartesian3())
      if (Cesium.defined(pos)) {
        o.point = {
          position: e.position, value: pos.clone(),
          billboardHr: e.billboard?.heightReference, labelHr: e.label?.heightReference, pointHr: e.point?.heightReference,
        }
      }
    }
    map.set(e.id, o)
  }
  return map
}

const scratchN = new Cesium.Cartesian3()
function lift(p: Cesium.Cartesian3, metres: number): Cesium.Cartesian3 {
  const n = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(p, scratchN)
  return Cesium.Cartesian3.add(p, Cesium.Cartesian3.multiplyByScalar(n, metres, new Cesium.Cartesian3()), new Cesium.Cartesian3())
}
function liftHierarchy(h: Cesium.PolygonHierarchy, metres: number): Cesium.PolygonHierarchy {
  return new Cesium.PolygonHierarchy(h.positions.map((p) => lift(p, metres)), h.holes.map((x) => liftHierarchy(x, metres)))
}

/**
 * Moves every entity of a layer up/down by `offsetM` metres from its LOADED geometry.
 * At offset 0 the entity's own properties are put back exactly as Cesium created them (3D polygons keep their heights,
 * clamped lines keep clamping). Callers must call this only when the offset CHANGED, never on every layer event.
 */
export function applyLayerOffset(ds: Cesium.DataSource, offsetM: number, origins: Map<string, EntityOrigin>): void {
  const C = Cesium.ConstantProperty
  for (const e of ds.entities.values) {
    const o = origins.get(e.id)
    if (!o) continue

    if (e.rectangle && o.rect) {
      if (offsetM === 0) { e.rectangle.height = o.rect.height as Cesium.Property; e.rectangle.heightReference = o.rect.heightReference as Cesium.Property }
      else { e.rectangle.heightReference = new C(Cesium.HeightReference.NONE); e.rectangle.height = new C(o.rect.value + offsetM) }
    }

    if (e.polygon && o.polygon) {
      const p = o.polygon
      if (offsetM === 0) {
        e.polygon.hierarchy = p.hierarchy as Cesium.Property; e.polygon.height = p.height as Cesium.Property
        e.polygon.heightReference = p.heightReference as Cesium.Property; e.polygon.perPositionHeight = p.perPositionHeight as Cesium.Property
        e.polygon.extrudedHeight = p.extrudedHeight as Cesium.Property
      } else {
        const perPosition = !!p.perPositionHeight?.getValue(Cesium.JulianDate.now())
        e.polygon.heightReference = new C(Cesium.HeightReference.NONE)
        if (perPosition && p.hierarchyValue) {
          e.polygon.hierarchy = new C(liftHierarchy(p.hierarchyValue, offsetM))   // 3D polygon: shift every vertex
        } else {
          e.polygon.perPositionHeight = new C(false)
          e.polygon.height = new C(p.heightValue + offsetM)
        }
        if (typeof p.extrudedValue === 'number') e.polygon.extrudedHeight = new C(p.extrudedValue + offsetM)
      }
    }

    if (e.polyline && o.line) {
      if (offsetM === 0) { e.polyline.positions = o.line.positions as Cesium.Property; e.polyline.clampToGround = o.line.clampToGround as Cesium.Property }
      else {
        e.polyline.clampToGround = new C(false)
        e.polyline.positions = new C(o.line.value.map((q) => lift(q, offsetM)))
      }
    }

    if (e.position && o.point) {
      const pt = o.point
      if (offsetM === 0) {
        e.position = pt.position as Cesium.PositionProperty
        if (e.billboard) e.billboard.heightReference = pt.billboardHr as Cesium.Property
        if (e.label) e.label.heightReference = pt.labelHr as Cesium.Property
        if (e.point) e.point.heightReference = pt.pointHr as Cesium.Property
      } else {
        if (e.billboard) e.billboard.heightReference = new C(Cesium.HeightReference.NONE)
        if (e.label) e.label.heightReference = new C(Cesium.HeightReference.NONE)
        if (e.point) e.point.heightReference = new C(Cesium.HeightReference.NONE)
        e.position = new Cesium.ConstantPositionProperty(lift(pt.value, offsetM))
      }
    }
  }
}

// ── Draping of point features ────────────────────────────────────────────────

/**
 * Points in drape mode. Cesium's own point clamping (billboard heightReference CLAMP_TO_GROUND, which GeoJSON sets for
 * clampToGround) is switched off and replaced by one height lookup on the model per point, so the points are plain
 * billboards/points that every GPU draws (clamped billboards stopped rendering under software WebGL in testing).
 * Returns when the lookups are done; points whose height is unknown stay where the file puts them.
 */
export async function drapePoints(v: Cesium.Viewer, ds: Cesium.DataSource, alive: () => boolean): Promise<void> {
  const now = Cesium.JulianDate.now()
  const ents = ds.entities.values.filter((e) => e.position && !e.polyline && !e.polygon && !e.rectangle)
  for (const e of ents) {
    // Undo Cesium's clamp flags: we place the point ourselves
    if (e.billboard) e.billboard.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
    if (e.label) e.label.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
    if (e.point) e.point.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
  }
  if (!ents.length || !v.scene.sampleHeightSupported) return
  const CHUNK = 500
  for (let i = 0; i < ents.length; i += CHUNK) {
    if (!alive() || v.isDestroyed()) return
    const chunk = ents.slice(i, i + CHUNK)
    const carts = chunk.map((e) => Cesium.Cartographic.fromCartesian(e.position!.getValue(now, new Cesium.Cartesian3()) as Cesium.Cartesian3))
    let sampled: (Cesium.Cartographic | undefined)[]
    try {
      // the layer's own entities are excluded, otherwise the ray hits the point's own pin at height 0
      sampled = await v.scene.sampleHeightMostDetailed(carts, ds.entities.values)
    } catch { return }
    if (!alive() || v.isDestroyed()) return
    chunk.forEach((e, k) => {
      const c = sampled[k]
      if (c && typeof c.height === 'number' && Number.isFinite(c.height)) {
        e.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height))
      }
    })
    v.scene.requestRender()
  }
}

// ── Draping on a glTF model ──────────────────────────────────────────────────

/**
 * Cesium's clampToGround only works on terrain and on 3D Tiles; a glTF model (an entity) is skipped, so 2-D layers
 * sank to the ellipsoid, far below the model. For a GLB the layer is therefore loaded unclamped and every vertex gets the
 * height of the model surface at its position (the same sampleHeightMostDetailed the Profile uses), a few cm above it:
 * points are moved, lines get extra vertices every ~2 m so they follow the relief, polygons take the sampled height per vertex.
 * `ready` resolves once the model can be sampled (sampling before that returns the bare globe, height 0).
 * Heights come back as the model surface where there is one and as the globe (height 0) where the feature leaves the model.
 */
export async function drapeOnModel(
  v: Cesium.Viewer, ds: Cesium.DataSource, ready: () => Promise<boolean>, alive: () => boolean, skip: Cesium.Entity[],
): Promise<void> {
  const now = Cesium.JulianDate.now()
  const NONE = Cesium.HeightReference.NONE
  const C = Cesium.ConstantProperty
  const LIFT = 0.3    // metres above the model: clear of thin raised features (a 0.2 m kerb) and of z-fighting
  const STEP = 2      // metres between vertices of a line
  const MAX_DENSIFY = 400
  interface Job { carts: Cesium.Cartographic[]; apply: (h: (number | undefined)[]) => void }
  const jobs: Job[] = []
  const toCarto = (p: Cesium.Cartesian3) => Cesium.Cartographic.fromCartesian(p)
  const fromCarto = (c: Cesium.Cartographic, h: number) => Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, h)

  for (const e of ds.entities.values) {
    if (e.billboard) e.billboard.heightReference = new C(NONE)
    if (e.label) e.label.heightReference = new C(NONE)
    if (e.point) e.point.heightReference = new C(NONE)
    if (e.rectangle) e.rectangle.heightReference = new C(NONE)

    if (e.polyline?.positions) {
      const pts = e.polyline.positions.getValue(now) as Cesium.Cartesian3[] | undefined
      if (!pts || pts.length < 2) continue
      const carts: Cesium.Cartographic[] = [toCarto(pts[0])]
      for (let i = 1; i < pts.length; i++) {
        const a = toCarto(pts[i - 1]), b = toCarto(pts[i])
        const len = Cesium.Cartesian3.distance(pts[i - 1], pts[i])
        const n = Math.min(MAX_DENSIFY, Math.max(1, Math.ceil(len / STEP)))
        for (let k = 1; k <= n; k++) {
          const t = k / n
          carts.push(new Cesium.Cartographic(a.longitude + (b.longitude - a.longitude) * t, a.latitude + (b.latitude - a.latitude) * t))
        }
      }
      jobs.push({ carts, apply: (h) => {
        e.polyline!.clampToGround = new C(false)
        e.polyline!.positions = new C(carts.map((c, i) => fromCarto(c, (h[i] ?? 0) + LIFT)))
      } })
    } else if (e.polygon?.hierarchy) {
      const hv = e.polygon.hierarchy.getValue(now) as Cesium.PolygonHierarchy | Cesium.Cartesian3[] | undefined
      const hier = hv && !Array.isArray(hv) ? hv : hv ? new Cesium.PolygonHierarchy(hv) : undefined
      if (!hier) continue
      const flat: Cesium.Cartographic[] = []
      const walk = (h: Cesium.PolygonHierarchy) => { h.positions.forEach((p) => flat.push(toCarto(p))); h.holes.forEach(walk) }
      walk(hier)
      jobs.push({ carts: flat, apply: (h) => {
        let i = 0
        const rebuild = (src: Cesium.PolygonHierarchy): Cesium.PolygonHierarchy => new Cesium.PolygonHierarchy(
          src.positions.map(() => { const c = flat[i]; const out = fromCarto(c, (h[i] ?? 0) + LIFT); i++; return out }),
          src.holes.map(rebuild),
        )
        e.polygon!.heightReference = new C(NONE)
        e.polygon!.height = undefined
        e.polygon!.extrudedHeight = undefined
        e.polygon!.perPositionHeight = new C(true)
        e.polygon!.hierarchy = new C(rebuild(hier))
      } })
    } else if (e.position && !e.rectangle) {
      const pos = e.position.getValue(now, new Cesium.Cartesian3())
      if (!Cesium.defined(pos)) continue
      const c = toCarto(pos)
      jobs.push({ carts: [c], apply: (h) => { e.position = new Cesium.ConstantPositionProperty(fromCarto(c, (h[0] ?? 0) + LIFT)) } })
    }
  }
  if (!jobs.length || !v.scene.sampleHeightSupported) return
  if (!(await ready()) || !alive() || v.isDestroyed()) return

  // One flat list, sampled in chunks; the sampled heights are handed back to each job in order
  const all: Cesium.Cartographic[] = []
  for (const j of jobs) all.push(...j.carts)
  const heights: (number | undefined)[] = new Array(all.length)
  const CHUNK = 500
  for (let i = 0; i < all.length; i += CHUNK) {
    if (!alive() || v.isDestroyed()) return
    let got: (Cesium.Cartographic | undefined)[]
    try { got = await v.scene.sampleHeightMostDetailed(all.slice(i, i + CHUNK).map((c) => new Cesium.Cartographic(c.longitude, c.latitude)), skip) } catch { return }
    got.forEach((c, k) => { heights[i + k] = c && Number.isFinite(c.height) ? c.height : undefined })
  }
  if (!alive() || v.isDestroyed()) return
  let at = 0
  for (const j of jobs) { j.apply(heights.slice(at, at + j.carts.length)); at += j.carts.length }
  v.scene.requestRender()
}

// ── Feature info (click popup) ───────────────────────────────────────────────

export interface FeatureInfo {
  title: string
  rows: [string, string][]
  /** lon/lat of the feature's position when it is a point */
  anchor?: { lon: number; lat: number }
  kind: 'point' | 'line' | 'area' | 'other'
}

const stripHtml = (html: string): string => {
  try { return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '' } catch { return '' }
}

export function describeEntity(e: Cesium.Entity): FeatureInfo {
  const now = Cesium.JulianDate.now()
  const rows: [string, string][] = []
  const props = e.properties
  if (props) {
    for (const name of props.propertyNames) {
      const val = props[name]?.getValue?.(now)
      if (val === undefined || val === null || val === '') continue
      rows.push([name, typeof val === 'object' ? JSON.stringify(val) : String(val)])
    }
  }
  const desc = e.description?.getValue(now)
  if (typeof desc === 'string' && desc.trim() && !rows.length) rows.push(['Description', stripHtml(desc).slice(0, 400)])
  const kind: FeatureInfo['kind'] = e.polygon || e.rectangle ? 'area' : e.polyline ? 'line' : e.position ? 'point' : 'other'
  let anchor: FeatureInfo['anchor']
  if (kind === 'point' && e.position) {
    const p = e.position.getValue(now, new Cesium.Cartesian3())
    if (p) { const c = Cesium.Cartographic.fromCartesian(p); anchor = { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) } }
  }
  return { title: e.name || String(props?.name?.getValue?.(now) ?? '') || 'Feature', rows: rows.slice(0, 14), anchor, kind }
}
