/**
 * Regression test for layer uploads (validation, the empty-.json bug, ITM reprojection, share access).
 * Runs against a LOCAL backend with a LOCAL S3 stand-in (never production):
 *
 *   API=http://127.0.0.1:3001/api TOKEN=<admin jwt> MODEL=<model id> PRIVATE_MODEL=<model id> SHARE=<share token for PRIVATE_MODEL> \
 *     node scripts/test-layers-upload.mjs
 *
 * Generates every input itself. Exit code 1 when any check fails.
 */
import { createHash } from 'node:crypto'

const API = process.env.API ?? 'http://127.0.0.1:3001/api'
const TOKEN = process.env.TOKEN
const MODEL = process.env.MODEL
if (!TOKEN || !MODEL) { console.error('TOKEN and MODEL are required'); process.exit(2) }

let failed = 0
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) failed++ }
const sha = (b) => createHash('sha256').update(b).digest('hex')

async function upload(filename, body, { type = 'application/json', crs, model = MODEL } = {}) {
  const q = new URLSearchParams({ filename, model_id: model, ...(crs ? { source_crs: crs } : {}) })
  const res = await fetch(`${API}/layers/upload?${q}`, { method: 'POST', body, headers: { 'Content-Type': type, Authorization: `Bearer ${TOKEN}` } })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}
// with a share token the request is made as an anonymous visitor (no admin header)
const list = async (model = MODEL, share) => (await fetch(`${API}/layers?model_id=${model}${share ? `&share=${share}` : ''}`, share ? {} : { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
async function stored(id) {
  const { url } = await (await fetch(`${API}/layers/${id}/download`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
  return Buffer.from(await (await fetch(url)).arrayBuffer())
}
const del = (id) => fetch(`${API}/layers/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } })

const fc = (features, extra = {}) => JSON.stringify({ type: 'FeatureCollection', ...extra, features })
const pt = (x, y, z) => ({ type: 'Feature', properties: { name: 'p' }, geometry: { type: 'Point', coordinates: z === undefined ? [x, y] : [x, y, z] } })
const created = []
const before = (await list()).length

// 1. valid GeoJSON named .json, sent as application/json (the browser behaviour that used to store 0 bytes)
{
  const body = Buffer.from(fc([pt(34.97, 32.83), { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[34.97, 32.83], [34.98, 32.84]] } }]))
  const r = await upload('small.json', body, { type: 'application/json' })
  ok('1.2 small .json as application/json is accepted', r.status === 201, JSON.stringify(r.json).slice(0, 120))
  if (r.status === 201) {
    created.push(r.json.id)
    const back = await stored(r.json.id)
    ok('1.2 stored bytes identical (size + sha256)', back.length === body.length && sha(back) === sha(body), `${back.length}/${body.length}`)
    ok('1.2 feature_count 2, status ready, clamp drape (2D)', r.json.feature_count === 2 && r.json.status === 'ready' && r.json.clamp_mode === 'drape')
  }
}
// 2. 250 KB .json (used to be 500 request entity too large)
{
  const feats = []; for (let i = 0; i < 4000; i++) feats.push(pt(34.9 + i * 1e-5, 32.8 + i * 1e-5))
  const body = Buffer.from(fc(feats));
  const r = await upload('big250.json', body, { type: 'application/json' })
  ok(`1.2 ${Math.round(body.length / 1024)} KB .json uploads without 500`, r.status === 201, String(r.status))
  if (r.status === 201) { created.push(r.json.id); ok('1.2 250 KB stored identical', sha(await stored(r.json.id)) === sha(body)) }
}
// 3. empty file
{
  const r = await upload('empty.json', Buffer.alloc(0), { type: 'application/json' })
  ok('1.2 empty file -> 400 with a readable message', r.status === 400 && /empty/i.test(r.json.error), r.json.error)
}
// 4. rejected files: no row is created
const rejects = [
  ['SHP zip', 'parcels.zip', Buffer.from('PK\x03\x04fake')],
  ['DXF', 'survey.dxf', Buffer.from('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n')],
  ['DWG', 'survey.dwg', Buffer.from('AC1027')],
  ['truncated JSON', 'trunc.geojson', Buffer.from('{"type":"FeatureCollection","features":[{"type":"Feature"')],
  ['not GeoJSON', 'obj.json', Buffer.from('{"hello":1}')],
  ['invalid KML', 'bad.kml', Buffer.from('<kml><Document><Placemark></Document></kml>')],
  ['ITM coords, no crs (WGS84 chosen)', 'itm.geojson', Buffer.from(fc([pt(197543, 748393)]))],
  ['ITM declared via crs member, WGS84 chosen', 'itmcrs.geojson', Buffer.from(fc([pt(197543, 748393)], { crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2039' } } }))],
  ['other crs declared (EPSG:3857)', 'webm.geojson', Buffer.from(fc([pt(3892000, 3820000)], { crs: { type: 'name', properties: { name: 'EPSG:3857' } } }))],
  ['out of range WGS84', 'range.geojson', Buffer.from(fc([pt(200, 95)]))],
  ['degrees but ITM chosen', 'deg.geojson', Buffer.from(fc([pt(34.97, 32.83)])), { crs: 'EPSG:2039' }],
  ['KML with a source crs choice', 'k.kml', Buffer.from('<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Point><coordinates>34.97,32.83,0</coordinates></Point></Placemark></Document></kml>'), { crs: 'EPSG:2039' }],
  ['list instead of CZML (.json)', 'czml.json', Buffer.from('[{"id":"document","version":"1.0"}]')],
  ['over the size limit (26 MB)', 'huge.geojson', Buffer.alloc(26 * 1024 * 1024, 32)],
  ['over 50,000 features', 'many.geojson', Buffer.from(fc(Array.from({ length: 50001 }, (_, i) => pt(34.9 + (i % 1000) * 1e-5, 32.8 + Math.floor(i / 1000) * 1e-5))))],
]
const countBeforeRejects = (await list()).length
for (const [name, file, body, opts] of rejects) {
  const r = await upload(file, body, { type: 'application/octet-stream', ...opts })
  ok(`1.3 ${name} -> ${r.status}`, r.status >= 400 && r.status < 500 && typeof r.json.error === 'string', r.json.error)
}
ok('1.3 no row created by any rejected upload', (await list()).length === countBeforeRejects)
{
  const r = await upload('itm.geojson', Buffer.from(fc([pt(197543, 748393)])), { type: 'application/octet-stream' })
  ok('1.3 ITM hint wording', /looks like ITM: convert to WGS84 first/.test(r.json.error), r.json.error)
}

// 5. ITM declared by the uploader is reprojected server-side and the source CRS is recorded
{
  const body = Buffer.from(fc([pt(197543.23, 748393.66, 40)], { crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2039' } } }))
  const r = await upload('itm_ok.geojson', body, { type: 'application/json', crs: 'EPSG:2039' })
  ok('ITM + source CRS selected -> 201, source_crs EPSG:2039 recorded', r.status === 201 && r.json.source_crs === 'EPSG:2039' && r.json.reprojected === true, JSON.stringify(r.json).slice(0, 100))
  if (r.status === 201) {
    created.push(r.json.id)
    const g = JSON.parse((await stored(r.json.id)).toString())
    const [lon, lat, z] = g.features[0].geometry.coordinates
    // PROJ 9.8 / pyproj EPSG:2039 -> 4326 for ITM (197543.23, 748393.66) gives 34.970409957, 32.830070024; allow 5 cm
    const dN = (lat - 32.830070024) * 110900, dE = (lon - 34.970409957) * 93550
    ok('ITM point matches PROJ/pyproj EPSG:2039 (within 5 cm)', Math.hypot(dN, dE) < 0.05, `lon ${lon.toFixed(6)} lat ${lat.toFixed(6)} off ${Math.hypot(dN, dE).toFixed(3)} m`)
    ok('z untouched, crs member removed, has_z', z === 40 && !('crs' in g) && r.json.has_z === 1 && r.json.clamp_mode === 'heights')
  }
}
// 6. WGS84 declared via CRS84 member is fine; empty collection = row with a warning; many features = warning
{
  const r = await upload('crs84.geojson', Buffer.from(fc([pt(34.97, 32.83)], { crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } })), { type: 'application/octet-stream' })
  ok('CRS84 member accepted', r.status === 201); if (r.status === 201) created.push(r.json.id)
  const e = await upload('empty_fc.geojson', Buffer.from(fc([])), { type: 'application/octet-stream' })
  ok('empty FeatureCollection -> row with "0 features" warning', e.status === 201 && /0 features/.test(e.json.status_message ?? ''), e.json.status_message); if (e.status === 201) created.push(e.json.id)
  const w = await upload('warn.geojson', Buffer.from(fc(Array.from({ length: 5200 }, (_, i) => pt(34.9 + (i % 100) * 1e-5, 32.8 + Math.floor(i / 100) * 1e-5)))), { type: 'application/octet-stream' })
  ok('5,200 features -> accepted with "may be slow on phones"', w.status === 201 && /slow on phones/.test(w.json.status_message ?? ''), w.json.status_message); if (w.status === 201) created.push(w.json.id)
}
// 7. KML / CZML accepted (KML hasZ detection)
{
  const kml = Buffer.from('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>a</name><Point><coordinates>34.97,32.83,20</coordinates></Point></Placemark></Document></kml>')
  const r = await upload('ok.kml', kml, { type: 'application/vnd.google-earth.kml+xml' })
  ok('valid KML accepted, has_z', r.status === 201 && r.json.has_z === 1 && r.json.feature_count === 1, r.json.error); if (r.status === 201) created.push(r.json.id)
  const cz = Buffer.from(JSON.stringify([{ id: 'document', version: '1.0' }, { id: 'a', position: { cartographicDegrees: [34.97, 32.83, 0] }, point: { pixelSize: 8 } }]))
  const c = await upload('ok.czml', cz, { type: 'application/json' })
  ok('valid CZML accepted (even as application/json)', c.status === 201 && c.json.feature_count === 1, c.json.error); if (c.status === 201) created.push(c.json.id)
}
// 8. access rules (needs PRIVATE_MODEL + SHARE)
if (process.env.PRIVATE_MODEL && process.env.SHARE) {
  const pm = process.env.PRIVATE_MODEL
  const a = await upload('priv_a.geojson', Buffer.from(fc([pt(34.97, 32.83)])), { type: 'application/octet-stream', model: pm })
  const b = await upload('priv_b.geojson', Buffer.from(fc([pt(34.98, 32.83)])), { type: 'application/octet-stream', model: pm })
  created.push(a.json.id, b.json.id)
  await fetch(`${API}/layers/${a.json.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ client_visible: true }) })
  const viaShare = await list(pm, process.env.SHARE)
  const anon = await (await fetch(`${API}/layers?model_id=${pm}`)).json()
  const wrongModel = await (await fetch(`${API}/layers?model_id=${MODEL}&share=${process.env.SHARE}`)).json()   // the public demo model: demo rules, still stripped
  ok('share link: only client_visible layers (1 of the private layers)', viaShare.filter((l) => [a.json.id, b.json.id].includes(l.id)).length === 1 && viaShare.find((l) => l.id === a.json.id))
  ok('share link: internal fields stripped', viaShare.every((l) => !('file_key' in l) && !('source_name' in l) && !('status_message' in l) && !('source_crs' in l) && !('client_visible' in l)))
  ok('no token on a private model -> []', Array.isArray(anon) && anon.length === 0)
  const dlOk = await fetch(`${API}/layers/${a.json.id}/download?share=${process.env.SHARE}`)
  const dlHidden = await fetch(`${API}/layers/${b.json.id}/download?share=${process.env.SHARE}`)
  const dlAnon = await fetch(`${API}/layers/${a.json.id}/download`)
  ok('share download: shared layer 200, hidden layer 404, anonymous 404', dlOk.status === 200 && dlHidden.status === 404 && dlAnon.status === 404, `${dlOk.status}/${dlHidden.status}/${dlAnon.status}`)
  const w = await fetch(`${API}/layers/${a.json.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible: false }) })
  ok('share/anonymous cannot PATCH or upload', w.status === 401)
  ok('share token for another model does not unlock this model', Array.isArray(wrongModel) && wrongModel.every((l) => !('client_visible' in l)))
}
// PATCH validation
if (created[0]) {
  const bad = await fetch(`${API}/layers/${created[0]}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ clamp_mode: 'sideways' }) })
  ok('PATCH rejects an invalid clamp_mode', bad.status === 400)
}
for (const id of created) await del(id)
ok('cleanup restored the layer count', (await list()).length === before)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
