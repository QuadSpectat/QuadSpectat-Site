/**
 * Official Israeli TM Grid (ITM, EPSG:2039) <-> WGS84. The ONE implementation in the frontend: the points panel, its CSV /
 * KML / HTML exports and the layer feature card all use it.
 *
 * ITM sits on the Israel 1993 datum, which is not WGS84: a plain Transverse Mercator without the datum shift is about
 * 78 m off near Haifa. Pipeline (same as PROJ's "Israel 1993 to WGS 84 (2)" + "Israeli TM"):
 *   WGS84 lat/lon -> geocentric -> inverse 7-parameter Helmert -> Israel 1993 lat/lon (GRS80) -> Transverse Mercator.
 * Verified against pyproj (EPSG:4326 <-> EPSG:2039) to well under 2 cm: see itm.test.ts.
 * The server (backend/src/layerGeo.ts) uses proj4 with the same parameters.
 */

const D2R = Math.PI / 180

// GRS80 (Israel 1993) and WGS84 ellipsoids
const A = 6378137.0
const F_GRS80 = 1 / 298.257222101
const F_WGS84 = 1 / 298.257223563
const e2 = (f: number) => 2 * f - f * f

// ITM projection constants
const K0 = 1.0000067
const LON0 = 35.2045169444444 * D2R
const LAT0 = 31.7343936111111 * D2R
const E0 = 219529.584
const N0 = 626907.39

// EPSG "Israel 1993 to WGS 84 (2)", position-vector convention, Israel 1993 -> WGS84
const T = [23.772, 17.49, 17.859]                       // metres
const RX = -0.3132 / 3600 * D2R, RY = -1.85274 / 3600 * D2R, RZ = 1.67299 / 3600 * D2R   // arc-seconds to radians
const S = -5.4262e-6                                    // scale (ppm)

function toGeocentric(lat: number, lon: number, h: number, f: number): [number, number, number] {
  const E2 = e2(f), sl = Math.sin(lat), n = A / Math.sqrt(1 - E2 * sl * sl)
  return [(n + h) * Math.cos(lat) * Math.cos(lon), (n + h) * Math.cos(lat) * Math.sin(lon), (n * (1 - E2) + h) * sl]
}

function fromGeocentric(x: number, y: number, z: number, f: number): [number, number] {
  const E2 = e2(f), p = Math.hypot(x, y)
  let lat = Math.atan2(z, p * (1 - E2))
  for (let i = 0; i < 6; i++) {
    const sl = Math.sin(lat), n = A / Math.sqrt(1 - E2 * sl * sl)
    lat = Math.atan2(z + E2 * n * sl, p)
  }
  return [lat, Math.atan2(y, x)]
}

/** Israel 1993 -> WGS84 Helmert applied to a geocentric point. */
function helmertForward([x, y, z]: number[]): number[] {
  const k = 1 + S
  return [
    T[0] + k * (x - RZ * y + RY * z),
    T[1] + k * (RZ * x + y - RX * z),
    T[2] + k * (-RY * x + RX * y + z),
  ]
}

/** Inverse of the Helmert, by fixed-point iteration (rotation/scale terms are about 1e-5, so a few steps are exact). */
function helmertInverse(p: number[]): number[] {
  let x = [p[0] - T[0], p[1] - T[1], p[2] - T[2]]
  for (let i = 0; i < 5; i++) {
    const f = helmertForward(x)
    x = [x[0] - (f[0] - p[0]), x[1] - (f[1] - p[1]), x[2] - (f[2] - p[2])]
  }
  return x
}

function meridionalArc(lat: number): number {
  const E2 = e2(F_GRS80), e4 = E2 * E2, e6 = e4 * E2
  return A * (
    (1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat
    - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat)
    - (35 * e6 / 3072) * Math.sin(6 * lat)
  )
}
const M0 = meridionalArc(LAT0)

/** Transverse Mercator of Israel-1993 geodetic coordinates (radians) on GRS80. Exported for the origin test only. */
export function itmFromDatumGeodetic(lat: number, lon: number): { easting: number; northing: number } {
  const E2 = e2(F_GRS80), ep2 = E2 / (1 - E2)
  const sl = Math.sin(lat), cl = Math.cos(lat), tl = Math.tan(lat)
  const N = A / Math.sqrt(1 - E2 * sl * sl)
  const Tt = tl * tl, C = ep2 * cl * cl, Av = cl * (lon - LON0), M = meridionalArc(lat)
  const easting = E0 + K0 * N * (Av + (1 - Tt + C) * Av ** 3 / 6 + (5 - 18 * Tt + Tt * Tt + 72 * C - 58 * ep2) * Av ** 5 / 120)
  const northing = N0 + K0 * ((M - M0) + N * tl * (Av ** 2 / 2 + (5 - Tt + 9 * C + 4 * C * C) * Av ** 4 / 24
    + (61 - 58 * Tt + Tt * Tt + 600 * C - 330 * ep2) * Av ** 6 / 720))
  return { easting, northing }
}

/** WGS84 degrees to official ITM metres. Heights are not involved. */
export function wgs84ToItm(latDeg: number, lonDeg: number): { easting: number; northing: number } {
  const g = toGeocentric(latDeg * D2R, lonDeg * D2R, 0, F_WGS84)
  const [x, y, z] = helmertInverse(g)
  const [lat, lon] = fromGeocentric(x, y, z, F_GRS80)
  return itmFromDatumGeodetic(lat, lon)
}

/** Official ITM metres to WGS84 degrees (inverse of wgs84ToItm, Newton iteration on the forward projection). */
export function itmToWgs84(easting: number, northing: number): { lat: number; lon: number } {
  let lat = LAT0 + (northing - N0) / 6.36e6, lon = LON0 + (easting - E0) / 5.4e6
  for (let i = 0; i < 8; i++) {
    const f = itmFromDatumGeodetic(lat, lon)
    const dE = easting - f.easting, dN = northing - f.northing
    if (Math.abs(dE) < 1e-6 && Math.abs(dN) < 1e-6) break
    const h = 1e-7
    const a = itmFromDatumGeodetic(lat + h, lon), b = itmFromDatumGeodetic(lat, lon + h)
    const j11 = (b.easting - f.easting) / h, j12 = (a.easting - f.easting) / h
    const j21 = (b.northing - f.northing) / h, j22 = (a.northing - f.northing) / h
    const det = j11 * j22 - j12 * j21
    lon += (dE * j22 - j12 * dN) / det
    lat += (j11 * dN - j21 * dE) / det
  }
  const [x, y, z] = helmertForward(toGeocentric(lat, lon, 0, F_GRS80))
  const [la, lo] = fromGeocentric(x, y, z, F_WGS84)
  return { lat: la / D2R, lon: lo / D2R }
}
