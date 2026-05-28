export interface GeoPoint {
  id: string
  lat: number   // WGS84 decimal degrees
  lon: number   // WGS84 decimal degrees
  alt: number   // metres above ellipsoid
  label: string // "P1", "P2", …
  note: string  // free-text user note
}

export function exportCsv(points: GeoPoint[]): void {
  const rows = [
    'Point,Label,Latitude (°),Longitude (°),Altitude (m),Note',
    ...points.map((p, i) =>
      `${i + 1},${p.label},${p.lat.toFixed(7)},${p.lon.toFixed(7)},${p.alt.toFixed(2)},"${p.note.replace(/"/g, '""')}"`
    ),
  ]
  triggerDownload(rows.join('\r\n'), 'geopoints.csv', 'text/csv')
}

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
