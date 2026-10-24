/**
 * ITM (EPSG:2039) tests against pyproj 3.8 / PROJ 9.8 (EPSG:4326 -> EPSG:2039, always_xy). Tolerance 2 cm.
 * Run:  ../backend/node_modules/.bin/tsx --test src/lib/itm.test.ts      (from frontend/)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgs84ToItm, itmToWgs84, itmFromDatumGeodetic } from './itm'

// name, lat, lon, expected easting, expected northing (pyproj)
const POINTS: [string, number, number, number, number][] = [
  ['Haifa', 32.83, 34.979, 198347.5284, 748384.1459],
  ['Haifa demo model', 32.83007, 34.97041, 197543.2340, 748393.6574],
  ['Tel Aviv', 32.0853, 34.7818, 179556.0303, 665855.3894],
  ['Jerusalem', 31.7683, 35.2137, 220333.4649, 630626.1340],
  ["Be'er Sheva", 31.253, 34.7915, 180122.6225, 573563.3386],
  ['Eilat', 29.5577, 34.9519, 194982.1158, 385574.2845],
  ['Metula', 33.2776, 35.5783, 254285.3168, 798065.8600],
  ['ITM origin latitude/longitude read as WGS84', 31.7343936111111, 35.2045169444444, 219463.5480, 626866.4266],
]

for (const [name, lat, lon, e, n] of POINTS) {
  test(`WGS84 -> ITM: ${name}`, () => {
    const r = wgs84ToItm(lat, lon)
    assert.ok(Math.abs(r.easting - e) < 0.02, `easting ${r.easting} vs ${e}`)
    assert.ok(Math.abs(r.northing - n) < 0.02, `northing ${r.northing} vs ${n}`)
  })
  test(`ITM -> WGS84: ${name}`, () => {
    const r = itmToWgs84(e, n)
    assert.ok(Math.abs(r.lat - lat) * 110946 < 0.02, `lat ${r.lat} vs ${lat}`)
    assert.ok(Math.abs(r.lon - lon) * 94000 < 0.02, `lon ${r.lon} vs ${lon}`)
  })
}

test('projection origin on the Israel 1993 datum is the false origin 219529.584 / 626907.39', () => {
  const r = itmFromDatumGeodetic(31.7343936111111 * Math.PI / 180, 35.2045169444444 * Math.PI / 180)
  assert.ok(Math.abs(r.easting - 219529.584) < 0.001 && Math.abs(r.northing - 626907.39) < 0.001)
})

test('the datum shift matters: about 78 m near Haifa (the old no-shift formula was that far off)', () => {
  const r = wgs84ToItm(32.83007, 34.97041)
  assert.ok(Math.hypot(r.easting - 197609.52, r.northing - 748433.98) > 70)
})
