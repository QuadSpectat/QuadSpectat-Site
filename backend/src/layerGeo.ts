import proj4 from 'proj4'

/**
 * Israeli TM Grid (ITM, EPSG:2039) to WGS84.
 *
 * ITM sits on the "Israel 1993" datum, which is NOT identical to WGS84: a plain Transverse Mercator formula
 * (no datum shift) puts a point near Haifa about 78 m away from where EPSG:2039 puts it.
 * +towgs84 is EPSG operation "Israel 1993 to WGS 84 (2)" (the one PROJ picks, 0.5 m accuracy), written in the
 * position-vector convention proj4 expects. Verified against PROJ 9.8 / pyproj to 1e-13 degrees.
 * (Do not copy the +towgs84 values shown on epsg.io for EPSG:2039: they are the opposite direction and give 1.6 m error.)
 * The viewer (frontend/src/lib/itm.ts) and the converter (tools/layer-convert) use the same parameters.
 */
export const ITM_PROJ4 =
  '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 ' +
  '+ellps=GRS80 +towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs'

const itmToWgs = proj4(ITM_PROJ4, 'WGS84')

/** ITM easting/northing (m) to [lon, lat] degrees. Heights are not touched by the caller. */
export function itmToWgs84(easting: number, northing: number): [number, number] {
  const [lon, lat] = itmToWgs.forward([easting, northing])
  return [lon, lat]
}

/** Rough extent of Israel in ITM metres (with a generous margin). Used to recognise ITM-looking values. */
export const ITM_RANGE = { minE: 50_000, maxE: 400_000, minN: 350_000, maxN: 900_000 }

export function looksLikeItm(x: number, y: number): boolean {
  return x >= ITM_RANGE.minE && x <= ITM_RANGE.maxE && y >= ITM_RANGE.minN && y <= ITM_RANGE.maxN
}

export function inWgs84Range(x: number, y: number): boolean {
  return Math.abs(x) <= 180 && Math.abs(y) <= 90
}
