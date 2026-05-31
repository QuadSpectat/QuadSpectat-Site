export interface GeoPoint {
  id: string
  lat: number       // WGS84 decimal degrees
  lon: number       // WGS84 decimal degrees
  alt: number       // metres above ellipsoid
  label: string     // "P1", "P2", …
  note: string      // free-text user note
  thumbnail?: string // base64 JPEG captured at collection time
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

// ── HTML report export (with embedded thumbnails) ────────────────────────────

export function exportHtmlReport(points: GeoPoint[], crs: ExportCrs = 'wgs84'): void {
  const hasThumbs = points.some((p) => p.thumbnail)

  const rows = points.map((p, i) => {
    let coords: string
    if (crs === 'itm') {
      const { easting, northing } = wgs84ToItm(p.lat, p.lon)
      coords = `E ${easting.toFixed(1)}<br>N ${northing.toFixed(1)}`
    } else {
      coords = `${p.lat.toFixed(6)}°<br>${p.lon.toFixed(6)}°`
    }

    const noteCell = p.note
      ? `<span dir="auto">${p.note.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`
      : '<span style="color:#aaa">—</span>'

    const imgCell = hasThumbs
      ? `<td>${p.thumbnail ? `<img src="${p.thumbnail}" style="width:220px;height:auto;border-radius:5px;display:block">` : ''}</td>`
      : ''

    return `<tr>
      <td style="text-align:center;font-weight:700;color:#89b4fa">${i + 1}</td>
      <td style="font-weight:600">${p.label}</td>
      <td style="font-family:monospace;font-size:12px">${coords}</td>
      <td style="font-family:monospace;font-size:12px">${p.alt.toFixed(1)} m</td>
      <td>${noteCell}</td>
      ${imgCell}
    </tr>`
  }).join('\n')

  const coordHeader = crs === 'itm' ? 'Easting / Northing (ITM)' : 'Latitude / Longitude (WGS84)'
  const thumbHeader = hasThumbs ? '<th>View</th>' : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Geopoints Report</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fb;color:#1e1e2e;margin:0;padding:24px}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:#888;font-size:12px;margin-bottom:20px}
  table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.10)}
  th{background:#313244;color:#cdd6f4;padding:10px 14px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
  td{border-bottom:1px solid #e9ecf0;padding:10px 14px;vertical-align:middle;font-size:13px}
  tr:last-child td{border-bottom:none}
  tr:nth-child(even) td{background:#f9fafb}
  @media print{body{background:#fff;padding:0}}
</style>
</head>
<body>
<h1>Collected Points</h1>
<p class="sub">Exported ${new Date().toLocaleString()} &nbsp;·&nbsp; CRS: ${crs.toUpperCase()} &nbsp;·&nbsp; ${points.length} point${points.length !== 1 ? 's' : ''}</p>
<table>
  <thead><tr>
    <th>#</th><th>Label</th><th>${coordHeader}</th><th>Altitude</th><th>Note</th>${thumbHeader}
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`

  triggerDownload('﻿' + html, 'geopoints_report.html', 'text/html;charset=utf-8')
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
