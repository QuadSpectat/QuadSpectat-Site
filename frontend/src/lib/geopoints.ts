export interface GeoPoint {
  id: string
  lat: number       // WGS84 decimal degrees
  lon: number       // WGS84 decimal degrees
  alt: number       // metres above the WGS84 ellipsoid (as shown by Cesium)
  altMsl?: number   // metres above sea level (EGM2008 geoid), when it could be worked out
  label: string     // "P1", "P2", …
  note: string      // free-text user note
  thumbnail?: string // base64 JPEG captured at collection time
}

export type ExportCrs = 'wgs84' | 'itm'

// ITM (EPSG:2039): the single official implementation (with the Israel 1993 datum shift) lives in itm.ts
import { wgs84ToItm } from './itm'
export { wgs84ToItm }

// ── CSV export ────────────────────────────────────────────────────────────────

// When any point has a thumbnail, the export is a ZIP bundle containing the
// CSV plus a `thumbs/` folder of JPEGs; the CSV's Thumbnail column references
// each file by name (e.g. `thumbs/p3.jpg`). When no thumbnails are present,
// falls back to a plain CSV file.
export async function exportCsv(points: GeoPoint[], crs: ExportCrs = 'wgs84'): Promise<void> {
  const hasThumbs = points.some((p) => p.thumbnail)

  let header: string
  let dataRows: string[]
  if (crs === 'itm') {
    header = 'Point,Label,Easting (m),Northing (m),Height above sea level, approx. (m),Ellipsoid height (m),Note'
    dataRows = points.map((p, i) => {
      const { easting, northing } = wgs84ToItm(p.lat, p.lon)
      return `${i + 1},${p.label},${easting.toFixed(3)},${northing.toFixed(3)},${p.altMsl != null ? p.altMsl.toFixed(2) : ''},${p.alt.toFixed(2)},"${p.note.replace(/"/g, '""')}"`
    })
  } else {
    header = 'Point,Label,Latitude (°),Longitude (°),Height above sea level, approx. (m),Ellipsoid height (m),Note'
    dataRows = points.map((p, i) =>
      `${i + 1},${p.label},${p.lat.toFixed(7)},${p.lon.toFixed(7)},${p.altMsl != null ? p.altMsl.toFixed(2) : ''},${p.alt.toFixed(2)},"${p.note.replace(/"/g, '""')}"`
    )
  }

  if (hasThumbs) {
    header += ',Thumbnail'
    dataRows = dataRows.map((row, i) =>
      row + (points[i].thumbnail ? `,thumbs/p${i + 1}.jpg` : ',')
    )
  }

  const csvText = '﻿' + [header, ...dataRows].join('\r\n')

  if (!hasThumbs) {
    triggerDownload(csvText, `geopoints_${crs}.csv`, 'text/csv;charset=utf-8')
    return
  }

  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('geopoints.csv', csvText)
  const thumbs = zip.folder('thumbs')!
  points.forEach((p, i) => {
    if (!p.thumbnail) return
    const b64 = p.thumbnail.split(',')[1]
    if (b64) thumbs.file(`p${i + 1}.jpg`, b64, { base64: true })
  })
  const blob = await zip.generateAsync({ type: 'blob' })
  triggerBlobDownload(blob, `geopoints_${crs}.zip`)
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
      <td style="font-family:monospace;font-size:12px">${p.altMsl != null ? `${p.altMsl.toFixed(2)} m<br><span style="color:#888">ellipsoid ${p.alt.toFixed(1)} m</span>` : `${p.alt.toFixed(1)} m (ellipsoid)`}</td>
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
<p class="sub" style="margin-bottom:6px">Indicative measurements. Heights above sea level are approximate (EGM2008 geoid), not a survey.</p>
<p class="sub">Exported ${new Date().toLocaleString()} &nbsp;·&nbsp; CRS: ${crs.toUpperCase()} &nbsp;·&nbsp; ${points.length} point${points.length !== 1 ? 's' : ''}</p>
<table>
  <thead><tr>
    <th>#</th><th>Label</th><th>${coordHeader}</th><th>Height above sea level (approx.)</th><th>Note</th>${thumbHeader}
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
      <coordinates>${p.lon.toFixed(7)},${p.lat.toFixed(7)},${(p.altMsl ?? p.alt).toFixed(2)}</coordinates>
    </Point>
  </Placemark>`,
    )
    .join('\n')

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Collected Points</name>
  <description>Indicative measurements. Heights above sea level are approximate (EGM2008 geoid).</description>
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
  triggerBlobDownload(new Blob([content], { type: mime }), filename)
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
