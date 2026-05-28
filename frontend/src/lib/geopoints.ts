export interface GeoPoint {
  id: string
  lat: number   // WGS84 decimal degrees
  lon: number   // WGS84 decimal degrees
  alt: number   // metres above ellipsoid
  label: string // "P1", "P2", …
  note: string  // free-text user note
}

export type ExportCrs = 'wgs84' | 'itm'

// ── ITM (EPSG:2039) projection ────────────────────────────────────────────────
// Transverse Mercator, GRS80 ellipsoid.
// Accuracy: sub-centimetre for all of Israel.

const A   = 6378137.0               // GRS80 semi-major axis (m)
const F   = 1 / 298.257222101       // GRS80 flattening
const E2  = 2 * F - F * F           // eccentricity²
const K0  = 1.0000067               // ITM scale factor
const LON0 = 35.2045169444 * (Math.PI / 180)   // central meridian
const LAT0 = 31.7343936111 * (Math.PI / 180)   // latitude of origin
const E0  = 219529.584              // false easting (m)
const N0  = 626907.390              // false northing (m)

function meridionalArc(lat: number): number {
  const e4 = E2 * E2, e6 = e4 * E2
  return A * (
    (1 - E2/4 - 3*e4/64 - 5*e6/256)   * lat
    - (3*E2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2 * lat)
    + (15*e4/256 + 45*e6/1024)         * Math.sin(4 * lat)
    - (35*e6/3072)                     * Math.sin(6 * lat)
  )
}

const M0 = meridionalArc(LAT0)

export function wgs84ToItm(latDeg: number, lonDeg: number): { easting: number; northing: number } {
  const lat  = latDeg * (Math.PI / 180)
  const dLon = lonDeg * (Math.PI / 180) - LON0

  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const tanLat = Math.tan(lat)

  const Nrad = A / Math.sqrt(1 - E2 * sinLat * sinLat)
  const T    = tanLat * tanLat
  const C    = (E2 / (1 - E2)) * cosLat * cosLat
  const Av   = cosLat * dLon
  const M    = meridionalArc(lat)

  const easting = E0 + K0 * Nrad * (
    Av
    + (1 - T + C) * Av**3 / 6
    + (5 - 18*T + T*T + 72*C - 58*(E2/(1-E2))) * Av**5 / 120
  )

  const northing = N0 + K0 * (
    (M - M0)
    + Nrad * tanLat * (
      Av**2 / 2
      + (5 - T + 9*C + 4*C*C)                               * Av**4 / 24
      + (61 - 58*T + T*T + 600*C - 330*(E2/(1-E2)))         * Av**6 / 720
    )
  )

  return { easting, northing }
}

// ── CSV export ────────────────────────────────────────────────────────────────

export function exportCsv(points: GeoPoint[], crs: ExportCrs = 'wgs84'): void {
  let rows: string[]

  if (crs === 'itm') {
    rows = [
      'Point,Label,Easting (m),Northing (m),Altitude (m),Note',
      ...points.map((p, i) => {
        const { easting, northing } = wgs84ToItm(p.lat, p.lon)
        return `${i + 1},${p.label},${easting.toFixed(3)},${northing.toFixed(3)},${p.alt.toFixed(2)},"${p.note.replace(/"/g, '""')}"`
      }),
    ]
  } else {
    rows = [
      'Point,Label,Latitude (°),Longitude (°),Altitude (m),Note',
      ...points.map((p, i) =>
        `${i + 1},${p.label},${p.lat.toFixed(7)},${p.lon.toFixed(7)},${p.alt.toFixed(2)},"${p.note.replace(/"/g, '""')}"`
      ),
    ]
  }

  triggerDownload('﻿' + rows.join('\r\n'), `geopoints_${crs}.csv`, 'text/csv;charset=utf-8')
}

// ── KML export (always WGS84 — KML spec requires it) ─────────────────────────

export function exportKml(points: GeoPoint[]): void {
  const placemarks = points
    .map(
      (p) => `  <Placemark>
    <name>${escapeXml(p.label)}</name>
    ${p.note ? `<description>${escapeXml(p.note)}</description>` : ''}
    <Point><altitudeMode>absolute</altitudeMode>
      <coordinates>${p.lon.toFixed(7)},${p.lat.toFixed(7)},${p.alt.toFixed(2)}</coordinates>
    </Point>
  </Placemark>`,
    )
    .join('\n')

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Collected Points</name>
  <Style id="geopin">
    <IconStyle><color>ff00aaff</color><scale>1.0</scale></IconStyle>
    <LabelStyle><scale>0.8</scale></LabelStyle>
  </Style>
${placemarks}
</Document>
</kml>`
  triggerDownload(kml, 'geopoints.kml', 'application/vnd.google-earth.kml+xml')
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
