/**
 * Layer upload limits and accepted formats: the ONE place to change them.
 * (The panel shows whatever message the server returns; GET /api/layers/limits publishes these numbers.)
 */
export const LAYER_LIMITS = {
  /** Hard limit per layer file (bytes). Larger uploads are refused with HTTP 413. */
  maxBytes: 25 * 1024 * 1024,
  /** Above this many features the layer is accepted with a warning ("may be slow on phones"). */
  warnFeatures: 5_000,
  /** Above this many features the layer is refused. */
  maxFeatures: 50_000,
  /** Accepted file extensions (lower case, no dot). Everything else is refused with a conversion hint. */
  extensions: ['geojson', 'json', 'kml', 'kmz', 'czml'] as readonly string[],
} as const

/** Coordinate systems a GeoJSON upload may declare as its source (stored layers are always WGS84). */
export const SOURCE_CRS_OPTIONS = ['EPSG:4326', 'EPSG:2039'] as const
export type SourceCrs = (typeof SOURCE_CRS_OPTIONS)[number]

export const mb = (bytes: number): string => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`
