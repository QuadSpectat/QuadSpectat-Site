import JSZip from 'jszip'
import { XMLValidator } from 'fast-xml-parser'
import { LAYER_LIMITS, mb } from './layerLimits'
import type { SourceCrs } from './layerLimits'
import { inWgs84Range, itmToWgs84, looksLikeItm } from './layerGeo'

/** A refusal with an HTTP status and a message written for the person who uploaded the file. */
export class LayerError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export type LayerKind = 'geojson' | 'kml' | 'kmz' | 'czml'

export interface LayerInfo {
  kind: LayerKind
  /** Bytes to store (original bytes unless the file was reprojected or its crs member removed). */
  body: Buffer
  ext: string
  contentType: string
  featureCount: number
  /** [west, south, east, north] in WGS84, or null when there is nothing to measure */
  bbox: [number, number, number, number] | null
  hasZ: boolean
  sourceCrs: SourceCrs
  reprojected: boolean
  warnings: string[]
}

const ITM_HINT = 'are not WGS84 degrees. This file looks like ITM: convert to WGS84 first (see the DXF/ITM converter, tools/layer-convert) or choose the source coordinate system "Israel ITM (EPSG:2039)"'
const fmt = (n: number) => n.toLocaleString('en-US')

const CONVERT_HINT: Record<string, string> = {
  dxf: 'DXF is not read by the viewer. Convert it to GeoJSON (WGS84) with tools/layer-convert first.',
  dwg: 'DWG is not read by the viewer. Export a DXF from AutoCAD (or use the free ODA File Converter), then convert it with tools/layer-convert.',
  zip: 'Shapefiles and other zip files are not read by the viewer. Convert them to GeoJSON (WGS84) first (KMZ files must end in .kmz).',
  shp: 'Shapefiles are not read by the viewer. Convert to GeoJSON (WGS84) first.',
}

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i < 0 ? '' : filename.slice(i + 1).toLowerCase()
}

interface Bounds { w: number; s: number; e: number; n: number; any: boolean }
const newBounds = (): Bounds => ({ w: Infinity, s: Infinity, e: -Infinity, n: -Infinity, any: false })
function grow(b: Bounds, lon: number, lat: number): void {
  b.any = true
  if (lon < b.w) b.w = lon
  if (lon > b.e) b.e = lon
  if (lat < b.s) b.s = lat
  if (lat > b.n) b.n = lat
}
const boundsOut = (b: Bounds): LayerInfo['bbox'] => (b.any ? [b.w, b.s, b.e, b.n] : null)

/** Main entry: throws LayerError for anything that must not become a layer. */
export async function validateLayer(filename: string, buf: Buffer, sourceCrsParam: string | undefined): Promise<LayerInfo> {
  const ext = extensionOf(filename)
  if (!LAYER_LIMITS.extensions.includes(ext)) {
    throw new LayerError(400, CONVERT_HINT[ext]
      ?? `".${ext || '?'}" files are not supported. Use ${LAYER_LIMITS.extensions.map((e) => '.' + e).join(' ')}.`)
  }
  if (buf.length === 0) throw new LayerError(400, 'The file is empty (0 bytes), nothing was uploaded. Pick the file again.')
  if (buf.length > LAYER_LIMITS.maxBytes) {
    throw new LayerError(413, `The file is ${mb(buf.length)}; the limit is ${mb(LAYER_LIMITS.maxBytes)} per layer. Simplify it or split it into several layers.`)
  }
  const sourceCrs: SourceCrs = sourceCrsParam === 'EPSG:2039' ? 'EPSG:2039' : 'EPSG:4326'
  if (sourceCrsParam && sourceCrsParam !== 'EPSG:2039' && sourceCrsParam !== 'EPSG:4326') {
    throw new LayerError(400, `Unknown source coordinate system "${sourceCrsParam}". Choose WGS84 (EPSG:4326) or Israel ITM (EPSG:2039).`)
  }

  let info: LayerInfo
  if (ext === 'kml') info = validateKml(buf.toString('utf8'), buf, 'kml', sourceCrs)
  else if (ext === 'kmz') info = await validateKmz(buf, sourceCrs)
  else if (ext === 'czml') info = validateCzml(buf, sourceCrs)
  else info = validateGeoJson(buf, sourceCrs)

  if (info.featureCount > LAYER_LIMITS.maxFeatures) {
    throw new LayerError(400, `The file has ${fmt(info.featureCount)} features; the limit is ${fmt(LAYER_LIMITS.maxFeatures)}. Simplify or split it.`)
  }
  if (info.featureCount === 0) info.warnings.push('0 features: nothing will be drawn.')
  else if (info.featureCount > LAYER_LIMITS.warnFeatures) {
    info.warnings.push(`${fmt(info.featureCount)} features: may be slow on phones.`)
  }
  return info
}

// ── GeoJSON ───────────────────────────────────────────────────────────────────

type Pos = number[]

function parseCrsMember(crs: unknown): string | null {
  if (crs == null) return null
  const c = crs as { type?: string; properties?: { name?: string } }
  if (c.type !== 'name' || typeof c.properties?.name !== 'string') return 'unsupported'
  const name = c.properties.name
  if (/CRS84/i.test(name)) return 'EPSG:4326'
  const m = /EPSG:{1,2}(\d+)/i.exec(name)
  return m ? `EPSG:${m[1]}` : name
}

function validateGeoJson(buf: Buffer, sourceCrs: SourceCrs): LayerInfo {
  let doc: unknown
  try {
    doc = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''))
  } catch (e) {
    throw new LayerError(400, `Not valid JSON (${(e as Error).message}). The file may be truncated or may not be GeoJSON.`)
  }
  if (Array.isArray(doc)) {
    throw new LayerError(400, 'This JSON is a list, not GeoJSON. If it is CZML, name the file .czml.')
  }
  const root = doc as Record<string, unknown>
  if (!root || typeof root !== 'object' || typeof root.type !== 'string') {
    throw new LayerError(400, 'Not GeoJSON: expected an object with a "type" of FeatureCollection, Feature or a geometry.')
  }

  // Declared crs member: only accepted when it matches what the uploader says the file is in.
  const declared = parseCrsMember(root.crs)
  let hadCrsMember = root.crs !== undefined
  if (declared) {
    if (declared === 'unsupported') throw new LayerError(400, 'The file has a "crs" member this viewer cannot read. Convert it to WGS84 first or remove the member.')
    if (declared === 'EPSG:2039' && sourceCrs !== 'EPSG:2039') {
      throw new LayerError(400, 'This file declares EPSG:2039 (Israel ITM) coordinates. Choose the source coordinate system "Israel ITM (EPSG:2039)" and upload it again, or convert it to WGS84 first (see tools/layer-convert).')
    }
    if (declared === 'EPSG:2039' && sourceCrs === 'EPSG:2039') { /* consistent */ }
    else if (declared !== 'EPSG:4326') {
      throw new LayerError(400, `This file declares ${declared}. Only WGS84 (EPSG:4326) and Israel ITM (EPSG:2039) are accepted; convert it to WGS84 first (see tools/layer-convert).`)
    } else if (sourceCrs === 'EPSG:2039') {
      throw new LayerError(400, 'The file declares WGS84 but you chose the source coordinate system ITM. Choose WGS84, or fix the file.')
    }
  }

  const bounds = newBounds()
  let featureCount = 0
  let hasZ = false
  let reproj = false
  const itm = sourceCrs === 'EPSG:2039'

  const visitPos = (p: Pos, holder: Pos[], idx: number): void => {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new LayerError(400, 'A coordinate is not a pair of numbers: the file is damaged or not GeoJSON.')
    }
    if (p.length > 2 && typeof p[2] === 'number' && Number.isFinite(p[2]) && p[2] !== 0) hasZ = true
    if (itm) {
      if (!looksLikeItm(p[0], p[1])) {
        if (inWgs84Range(p[0], p[1])) {
          throw new LayerError(400, `You chose ITM but the coordinates (e.g. ${p[0]}, ${p[1]}) look like degrees (WGS84). Choose WGS84 as the source coordinate system.`)
        }
        throw new LayerError(400, `You chose ITM but the coordinates (e.g. ${p[0]}, ${p[1]}) are outside Israel's grid (E 50,000 to 400,000, N 350,000 to 900,000). Check the coordinate system of the file.`)
      }
      const [lon, lat] = itmToWgs84(p[0], p[1])
      const out: Pos = p.length > 2 ? [lon, lat, p[2]] : [lon, lat]
      holder[idx] = out
      reproj = true
      grow(bounds, lon, lat)
    } else {
      if (!inWgs84Range(p[0], p[1])) {
        if (looksLikeItm(p[0], p[1])) throw new LayerError(400, `The coordinates (e.g. ${p[0]}, ${p[1]}) ${ITM_HINT}.`)
        throw new LayerError(400, `The coordinates (e.g. ${p[0]}, ${p[1]}) are outside the WGS84 range (longitude -180..180, latitude -90..90). The file is in a projected or unknown coordinate system: convert it to WGS84 first (see tools/layer-convert).`)
      }
      grow(bounds, p[0], p[1])
    }
  }

  const visitCoords = (c: unknown, depth: number): void => {
    // depth 0 = a position, depth 1 = array of positions, ...
    if (!Array.isArray(c)) throw new LayerError(400, 'A geometry has coordinates that are not a list: the file is damaged or not GeoJSON.')
    if (depth === 0) { visitPos(c as Pos, [c as Pos], 0); return }
    const arr = c as unknown[]
    if (depth === 1) {
      for (let i = 0; i < arr.length; i++) visitPos(arr[i] as Pos, arr as Pos[], i)
    } else {
      for (const sub of arr) visitCoords(sub, depth - 1)
    }
  }

  const DEPTH: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }
  const visitGeometry = (g: unknown): void => {
    if (g == null) return
    const geom = g as { type?: string; coordinates?: unknown; geometries?: unknown[] }
    if (geom.type === 'GeometryCollection') {
      if (!Array.isArray(geom.geometries)) throw new LayerError(400, 'A GeometryCollection has no "geometries" list.')
      geom.geometries.forEach(visitGeometry)
      return
    }
    const depth = typeof geom.type === 'string' ? DEPTH[geom.type] : undefined
    if (depth === undefined) throw new LayerError(400, `Unknown geometry type "${String(geom.type)}": the file is not valid GeoJSON.`)
    if (depth === 0) {
      if (!Array.isArray(geom.coordinates)) throw new LayerError(400, 'A Point has no coordinates.')
      const holder = [geom.coordinates as Pos]
      visitPos(holder[0], holder, 0)
      geom.coordinates = holder[0]
    } else {
      visitCoords(geom.coordinates, depth)
    }
  }

  switch (root.type) {
    case 'FeatureCollection': {
      if (!Array.isArray(root.features)) throw new LayerError(400, 'The FeatureCollection has no "features" list.')
      for (const f of root.features as Array<{ type?: string; geometry?: unknown }>) {
        if (!f || f.type !== 'Feature') throw new LayerError(400, 'The "features" list contains an item that is not a Feature.')
        featureCount++
        visitGeometry(f.geometry)
      }
      break
    }
    case 'Feature':
      featureCount = 1
      visitGeometry((root as { geometry?: unknown }).geometry)
      break
    default:
      featureCount = 1
      visitGeometry(root)
  }

  let body = buf
  if (reproj || hadCrsMember) {
    delete root.crs   // stored layers are plain WGS84; Cesium needs no crs member
    hadCrsMember = false
    body = Buffer.from(JSON.stringify(root), 'utf8')
  }
  return {
    kind: 'geojson', body, ext: 'geojson', contentType: 'application/geo+json',
    featureCount, bbox: boundsOut(bounds), hasZ, sourceCrs, reprojected: reproj, warnings: [],
  }
}

// ── KML / KMZ ─────────────────────────────────────────────────────────────────

function validateKml(text: string, raw: Buffer, kind: 'kml' | 'kmz', sourceCrs: SourceCrs, storeAs?: Buffer): LayerInfo {
  if (sourceCrs === 'EPSG:2039') {
    throw new LayerError(400, 'KML is always WGS84, so a source coordinate system cannot be chosen for it. Choose WGS84.')
  }
  const xml = text.replace(/^﻿/, '')
  const ok = XMLValidator.validate(xml)
  if (ok !== true) {
    const e = (ok as { err: { msg: string; line: number } }).err
    throw new LayerError(400, `Not valid KML: the XML is damaged near line ${e.line} (a tag is not closed, or tags are out of order).`)
  }
  if (!/<kml[\s>]/i.test(xml)) throw new LayerError(400, 'Not KML: the file has no <kml> element.')

  const featureCount = (xml.match(/<Placemark[\s>]/g) ?? []).length + (xml.match(/<GroundOverlay[\s>]/g) ?? []).length
  const bounds = newBounds()
  let hasZ = false
  let itmLike: string | null = null
  const re = /<coordinates>([\s\S]*?)<\/coordinates>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    for (const tup of m[1].trim().split(/\s+/)) {
      if (!tup) continue
      const [x, y, z] = tup.split(',').map(Number)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new LayerError(400, `A KML coordinate ("${tup.slice(0, 40)}") is not a number pair.`)
      }
      if (!inWgs84Range(x, y)) {
        if (looksLikeItm(x, y)) itmLike = tup
        throw new LayerError(400, itmLike
          ? `The KML coordinates (e.g. ${x}, ${y}) are not WGS84 degrees. This file looks like ITM: convert it to WGS84 first (see the DXF/ITM converter, tools/layer-convert); KML must be in longitude/latitude.`
          : `The KML coordinates (e.g. ${x}, ${y}) are outside the WGS84 range. KML must be in longitude/latitude degrees.`)
      }
      if (Number.isFinite(z) && z !== 0) hasZ = true
      grow(bounds, x, y)
    }
  }
  const warnings: string[] = []
  if (/<NetworkLink[\s>]/.test(xml)) warnings.push('The KML links to other files (NetworkLink); those are not loaded.')
  return {
    kind, body: storeAs ?? raw, ext: kind, contentType: kind === 'kmz' ? 'application/vnd.google-earth.kmz' : 'application/vnd.google-earth.kml+xml',
    featureCount, bbox: boundsOut(bounds), hasZ, sourceCrs: 'EPSG:4326', reprojected: false, warnings,
  }
}

async function validateKmz(buf: Buffer, sourceCrs: SourceCrs): Promise<LayerInfo> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buf)
  } catch {
    throw new LayerError(400, 'Not a valid KMZ: the file is not a readable zip archive.')
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir)
  if (names.length > 2000) throw new LayerError(400, 'The KMZ contains too many files.')
  const kmlName = names.find((n) => n.toLowerCase() === 'doc.kml') ?? names.find((n) => !n.includes('/') && n.toLowerCase().endsWith('.kml'))
  if (!kmlName) throw new LayerError(400, 'The KMZ has no doc.kml inside, so it cannot be shown.')
  const text = await zip.files[kmlName].async('string')
  if (text.length > LAYER_LIMITS.maxBytes * 4) throw new LayerError(413, 'The KMZ expands to far more than the size limit.')
  return validateKml(text, buf, 'kmz', sourceCrs)
}

// ── CZML ──────────────────────────────────────────────────────────────────────

function validateCzml(buf: Buffer, sourceCrs: SourceCrs): LayerInfo {
  if (sourceCrs === 'EPSG:2039') throw new LayerError(400, 'CZML is always WGS84: choose WGS84 as the source coordinate system.')
  let doc: unknown
  try {
    doc = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''))
  } catch (e) {
    throw new LayerError(400, `Not valid CZML (JSON error: ${(e as Error).message}).`)
  }
  if (!Array.isArray(doc) || doc.some((p) => !p || typeof p !== 'object')) {
    throw new LayerError(400, 'Not CZML: expected a JSON list of packets, the first one with id "document".')
  }
  const packets = doc as Array<{ id?: string }>
  if (!packets.length || packets[0].id !== 'document') {
    throw new LayerError(400, 'Not CZML: the first packet must have id "document".')
  }
  const featureCount = packets.filter((p) => p.id !== 'document').length
  return {
    kind: 'czml', body: buf, ext: 'czml', contentType: 'application/json',
    featureCount, bbox: null, hasZ: false, sourceCrs: 'EPSG:4326', reprojected: false, warnings: [],
  }
}
