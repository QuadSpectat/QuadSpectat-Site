/**
 * Official Israeli TM Grid (ITM, EPSG:2039) conversion for LAYER coordinates.
 *
 * Same definition as the server (backend/src/layerGeo.ts) and the converter (tools/layer-convert): EPSG operation
 * "Israel 1993 to WGS 84 (2)", verified against PROJ/pyproj to 1e-13 degrees. proj4 is imported lazily, so it is only
 * downloaded the first time someone asks for ITM.
 *
 * NOTE: geopoints.ts (`wgs84ToItm`, the points panel) applies NO datum shift and therefore differs from this by about
 * 78 m near Haifa. Layer coordinates use this module; see the report before changing the points panel.
 */
import { useEffect, useState } from 'react'

export const ITM_PROJ4 =
  '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 ' +
  '+ellps=GRS80 +towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs'

export type ToItm = (lonDeg: number, latDeg: number) => { easting: number; northing: number }

let cached: Promise<ToItm> | null = null

export function loadItm(): Promise<ToItm> {
  if (!cached) {
    cached = import('proj4').then(({ default: proj4 }) => {
      const fwd = proj4('WGS84', ITM_PROJ4)
      return (lon: number, lat: number) => {
        const [easting, northing] = fwd.forward([lon, lat])
        return { easting, northing }
      }
    })
    cached.catch(() => { cached = null })
  }
  return cached
}

/** The converter once it has loaded (null until then or on failure), loading only when `wanted`. */
export function useItm(wanted: boolean): ToItm | null {
  const [fn, setFn] = useState<ToItm | null>(null)
  useEffect(() => {
    if (!wanted || fn) return
    let live = true
    loadItm().then((f) => { if (live) setFn(() => f) }).catch(console.error)
    return () => { live = false }
  }, [wanted, fn])
  return fn
}
