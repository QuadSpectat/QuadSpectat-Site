import { Router, Request, Response, NextFunction } from 'express'
import express from 'express'
import { db, randomUUID } from '../db'
import { uploadObject, uploadFile, presignUpload, presignDownload } from '../s3'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { fromUrl, GeoTIFFImage } from 'geotiff'
import sharp from 'sharp'

const router = Router()

// Half-extent of EPSG:3857: π × 6378137
const EARTH_HALF = 20037508.342789244

// ── COG metadata cache ────────────────────────────────────────────────────────
// Avoids re-fetching the TIFF header on every tile request.
// Each entry lives for 50 min — well within the 1-hour presigned URL expiry.

interface OverviewLevel {
  image:      GeoTIFFImage
  origin:     [number, number]
  resolution: [number, number]  // [xRes, yRes]; yRes < 0
  width:      number
  height:     number
}

interface CogMeta {
  image:      GeoTIFFImage
  origin:     number[]
  resolution: number[]
  bands:      number
  nodata:     number | null
  imageW:     number
  imageH:     number
  expiry:     number
  /** All IFDs sorted finest→coarsest (overviews[0] = full resolution). */
  overviews:  OverviewLevel[]
}

const cogMetaCache = new Map<string, CogMeta | Promise<CogMeta>>()

async function getCogMeta(cogKey: string): Promise<CogMeta> {
  const hit = cogMetaCache.get(cogKey)
  if (hit instanceof Promise) return hit
  if (hit && hit.expiry > Date.now()) return hit

  const promise = (async (): Promise<CogMeta> => {
    const url        = await presignDownload(cogKey)
    const tiff       = await fromUrl(url)
    const imageCount = await tiff.getImageCount()

    // IFD 0 always carries the geotransform; overview IFDs typically do not.
    // Derive overview resolutions by scaling the full-resolution pixel size.
    const fullImg    = await tiff.getImage(0)
    const fullOrigin = fullImg.getOrigin()     as [number, number]
    const fullRes    = fullImg.getResolution() as [number, number]
    const fullW      = fullImg.getWidth()
    const fullH      = fullImg.getHeight()

    const ovs: OverviewLevel[] = []
    for (let i = 0; i < imageCount; i++) {
      const img = i === 0 ? fullImg : await tiff.getImage(i)
      const w   = img.getWidth()
      const h   = img.getHeight()
      const xRes = fullRes[0] * (fullW / w)
      const yRes = fullRes[1] * (fullH / h)
      ovs.push({ image: img, origin: fullOrigin, resolution: [xRes, yRes], width: w, height: h })
    }
    ovs.sort((a, b) => Math.abs(a.resolution[0]) - Math.abs(b.resolution[0]))

    const full = ovs[0]
    const meta: CogMeta = {
      image:      full.image,
      origin:     full.origin,
      resolution: full.resolution,
      bands:      full.image.getSamplesPerPixel(),
      nodata:     full.image.getGDALNoData(),
      imageW:     full.width,
      imageH:     full.height,
      expiry:     Date.now() + 50 * 60 * 1000,
      overviews:  ovs,
    }
    console.log(`[cog] ${cogKey.split('/').pop()} IFDs:${imageCount} fullRes:${meta.imageW}x${meta.imageH} res:${meta.resolution[0].toFixed(3)},${meta.resolution[1].toFixed(3)}`)
    cogMetaCache.set(cogKey, meta)
    return meta
  })()

  cogMetaCache.set(cogKey, promise)
  return promise
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await db.query<OrthoRow>(`SELECT * FROM orthophotos ORDER BY created_at DESC`)
    res.json(rows)
  } catch (err) { next(err) }
})

// ── Get single ────────────────────────────────────────────────────────────────
router.get('/:id([0-9a-f-]{36})', async (req, res, next) => {
  try {
    const { rows } = await db.query<OrthoRow>(`SELECT * FROM orthophotos WHERE id = $1`, [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// ── Presign ───────────────────────────────────────────────────────────────────
router.post('/presign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { filename, contentType } = req.body as Record<string, unknown>
    if (typeof filename !== 'string' || typeof contentType !== 'string') {
      return res.status(400).json({ error: 'filename and contentType are required strings' })
    }
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'tif'
    const key = `orthophotos/raw/${randomUUID()}.${ext}`
    const url = await presignUpload(key, contentType)
    res.json({ key, url, expiresIn: Number(process.env.PRESIGN_EXPIRY_SECONDS ?? 3600) })
  } catch (err) { next(err) }
})

// ── Create (after presigned upload) ──────────────────────────────────────────
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asset_name, name, description, raw_key, original_format, cog_ready } = req.body as Record<string, unknown>
    if (typeof asset_name !== 'string' || !asset_name) return res.status(400).json({ error: 'asset_name is required' })
    if (typeof name !== 'string' || !name) return res.status(400).json({ error: 'name is required' })
    if (typeof raw_key !== 'string' || !raw_key) return res.status(400).json({ error: 'raw_key is required' })

    const id        = randomUUID()
    const fmt       = typeof original_format === 'string' ? original_format : 'unknown'
    const desc      = typeof description === 'string' ? description : null
    const cogReady  = cog_ready === true

    const { rows } = await db.query<OrthoRow>(
      `INSERT INTO orthophotos (id, asset_name, name, description, file_key, original_format, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
      [id, asset_name, name, desc, raw_key, fmt],
    )
    res.status(201).json(rows[0])

    processOrthophoto(id, raw_key, cogReady).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[orthophoto] processing error:', msg)
      db.query(
        `UPDATE orthophotos SET status = 'error', error_message = $1, updated_at = datetime('now') WHERE id = $2`,
        [msg.slice(0, 1000), id],
      ).catch(console.error)
    })
  } catch (err) { next(err) }
})

// ── Upload (raw-body proxy, kept for direct browser uploads) ─────────────────
router.post('/upload',
  express.raw({ type: '*/*', limit: '2gb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { filename, asset_name } = req.query as Record<string, string>
      if (!filename) return res.status(400).json({ error: 'filename required' })

      const ext = filename.split('.').pop()?.toLowerCase() ?? 'tif'
      const id = randomUUID()
      const fileKey = `orthophotos/${id}/original.${ext}`
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
      // Use filename (without extension) as asset_name if not provided
      const finalAssetName = asset_name?.trim() || filename.replace(/\.[^.]+$/, '')
      const displayName = filename.replace(/\.[^.]+$/, '')

      await uploadObject(fileKey, body, 'image/tiff')

      const { rows } = await db.query<OrthoRow>(
        `INSERT INTO orthophotos (id, asset_name, name, file_key, original_format, status)
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
        [id, finalAssetName, displayName, fileKey, ext],
      )
      res.status(201).json(rows[0])

      // Kick off async GDAL processing (non-blocking)
      processOrthophoto(id, fileKey).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[orthophoto] processing error:', msg)
        db.query(
          `UPDATE orthophotos SET status = 'error', error_message = $1, updated_at = datetime('now') WHERE id = $2`,
          [msg.slice(0, 1000), id],
        ).catch(console.error)
      })
    } catch (err) { next(err) }
  },
)

// ── Update opacity / visibility ───────────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { visible, opacity } = req.body as { visible?: boolean; opacity?: number }
    const fields: string[] = []
    const vals: unknown[] = []
    if (visible !== undefined) { fields.push(`visible = $${vals.length + 1}`); vals.push(visible ? 1 : 0) }
    if (opacity  !== undefined) { fields.push(`opacity  = $${vals.length + 1}`); vals.push(opacity) }
    if (!fields.length) return res.status(400).json({ error: 'nothing to update' })
    vals.push(req.params.id)
    const { rows } = await db.query<OrthoRow>(
      `UPDATE orthophotos SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = $${vals.length} RETURNING *`,
      vals,
    )
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) { next(err) }
})

// ── Adopt an existing converted COG ───────────────────────────────────────────
// POST /api/orthophotos/:id/adopt-cog  body: { cog_key: "orthophotos/.../cog.tif" }
// Points the row at an already-converted EPSG:3857 COG and recomputes bounds +
// zoom_max from it. Use when the raw upload is corrupt but a good COG was
// uploaded separately (e.g. local-convert tool output).
router.post('/:id([0-9a-f-]{36})/adopt-cog', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cog_key } = req.body as Record<string, unknown>
    if (typeof cog_key !== 'string' || !cog_key) {
      return res.status(400).json({ error: 'cog_key (string) is required in body' })
    }
    const { rows } = await db.query<OrthoRow>(`SELECT * FROM orthophotos WHERE id = $1`, [req.params.id])
    const photo = rows[0]
    if (!photo) return res.status(404).json({ error: 'Not found' })

    if (photo.cog_key) cogMetaCache.delete(photo.cog_key)
    cogMetaCache.delete(cog_key)

    const url      = await presignDownload(cog_key)
    const infoJson = await runProcess('gdalinfo', ['-json', `/vsicurl/${url}`], {
      GDAL_CACHEMAX: '128', GDAL_HTTP_TIMEOUT: '180',
    })
    const info = JSON.parse(infoJson) as { wgs84Extent?: { coordinates: number[][][] } }
    const coords = info.wgs84Extent?.coordinates?.[0] ?? []
    const lons = coords.map((c) => c[0])
    const lats = coords.map((c) => c[1])
    if (!lons.length) return res.status(400).json({ error: 'Could not read bounds from the COG' })
    const bW = Math.min(...lons), bE = Math.max(...lons)
    const bS = Math.min(...lats), bN = Math.max(...lats)

    const tiff   = await fromUrl(url)
    const image  = await tiff.getImage()
    const [xRes] = image.getResolution()
    const zoomMax = Math.max(0, Math.min(22,
      Math.round(Math.log2((EARTH_HALF * 2) / (256 * Math.abs(xRes)))),
    ))

    const { rows: updated } = await db.query<OrthoRow>(
      `UPDATE orthophotos SET
         status = 'ready', cog_key = $1, error_message = NULL,
         bounds_west = $2, bounds_south = $3, bounds_east = $4, bounds_north = $5,
         zoom_max = $6, updated_at = datetime('now')
       WHERE id = $7 RETURNING *`,
      [cog_key, bW, bS, bE, bN, zoomMax, req.params.id],
    )
    res.json(updated[0])
  } catch (err) { next(err) }
})

// ── Inspect (read-only gdalinfo on cog_key) ───────────────────────────────────
// GET /api/orthophotos/:id/inspect → gdalinfo -json output for the cog_key.
// Lightweight (no gdalwarp), so it doesn't OOM on Fly. Used to diagnose
// whether a row's COG is actually EPSG:3857 with sensible bounds.
router.get('/:id([0-9a-f-]{36})/inspect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query<OrthoRow>(`SELECT cog_key, file_key FROM orthophotos WHERE id = $1`, [req.params.id])
    const photo = rows[0]
    if (!photo) return res.status(404).json({ error: 'Not found' })
    const key = photo.cog_key || photo.file_key
    if (!key) return res.status(400).json({ error: 'No cog_key or file_key on record' })

    const url = await presignDownload(key)
    const out = await runProcess('gdalinfo', ['-json', `/vsicurl/${url}`], {
      GDAL_CACHEMAX: '64', GDAL_HTTP_TIMEOUT: '60',
    })
    const info = JSON.parse(out) as Record<string, unknown>
    res.json({
      key,
      coordinateSystem: (info as { coordinateSystem?: { wkt?: string } }).coordinateSystem?.wkt?.split('\n')[0],
      size:        info.size,
      geoTransform: info.geoTransform,
      bands:       Array.isArray(info.bands) ? info.bands.length : null,
      wgs84Extent: info.wgs84Extent,
    })
  } catch (err) { next(err) }
})

// ── Reprocess (server-side gdalwarp + COG) ────────────────────────────────────
// Use when a row's cog_key points at a file that isn't actually an EPSG:3857 COG
// (e.g. uploaded with cog_ready=true but produced bad output). Re-runs the full
// processing pipeline on file_key — overwrites cog_key and bounds.
router.post('/:id([0-9a-f-]{36})/reprocess', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query<OrthoRow>(`SELECT * FROM orthophotos WHERE id = $1`, [req.params.id])
    const photo = rows[0]
    if (!photo) return res.status(404).json({ error: 'Not found' })
    if (!photo.file_key) return res.status(400).json({ error: 'No file_key on record' })

    // Drop any cached metadata for the stale cog_key so the next tile read picks up the new file
    if (photo.cog_key) cogMetaCache.delete(photo.cog_key)

    // Respond immediately — processing runs async (like initial upload)
    res.status(202).json({ status: 'reprocessing', id: photo.id })

    processOrthophoto(photo.id, photo.file_key, false).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[orthophoto] reprocess error:', msg)
      db.query(
        `UPDATE orthophotos SET status = 'error', error_message = $1, updated_at = datetime('now') WHERE id = $2`,
        [msg.slice(0, 1000), photo.id],
      ).catch(console.error)
    })
  } catch (err) { next(err) }
})

// ── Delete ────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query<OrthoRow>(
      `DELETE FROM orthophotos WHERE id = $1 RETURNING *`,
      [req.params.id],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) { next(err) }
})

// ── Tile serving ──────────────────────────────────────────────────────────────
// GET /api/orthophotos/:id/tiles/:z/:x/:y(.png)
router.get('/:id([0-9a-f-]{36})/tiles/:z/:x/:y', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, z, x } = req.params
    const tz = parseInt(z)
    const tx = parseInt(x)
    const ty = parseInt(req.params.y)  // parseInt handles "200.png" → 200
    if (isNaN(tz) || isNaN(tx) || isNaN(ty)) return res.status(400).end()

    const { rows } = await db.query<OrthoRow>(`SELECT * FROM orthophotos WHERE id = $1`, [id])
    const photo = rows[0]
    if (!photo) return res.status(404).end()
    if (photo.status !== 'ready' || !photo.cog_key) return res.status(202).end()

    // ETag keyed on cog_key + updated_at so adopt-cog / reprocess automatically
    // invalidates cached tiles in the browser. We still want a short max-age so
    // navigation feels snappy, but no_cache=true forces revalidation.
    const etag = `"${photo.cog_key}-${photo.updated_at}"`
    if (req.headers['if-none-match'] === etag) return res.status(304).end()
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate')
    res.setHeader('ETag', etag)

    // XYZ tile → EPSG:3857 bounding box (y=0 at north)
    const tileSize = (EARTH_HALF * 2) / Math.pow(2, tz)
    const xMin =  tx       * tileSize - EARTH_HALF
    const xMax = (tx + 1)  * tileSize - EARTH_HALF
    const yMax = EARTH_HALF -  ty      * tileSize
    const yMin = EARTH_HALF - (ty + 1) * tileSize

    // Pre-check: tile must intersect orthophoto bounds
    if (photo.bounds_west !== null) {
      const bW = lon2merc(photo.bounds_west)
      const bE = lon2merc(photo.bounds_east!)
      const bS = lat2merc(photo.bounds_south!)
      const bN = lat2merc(photo.bounds_north!)
      if (xMax <= bW || xMin >= bE || yMax <= bS || yMin >= bN) {
        return res.end(await emptyTile())
      }
    }

    // Read tile from cached COG metadata (avoids re-fetching TIFF header per tile)
    let png: Buffer
    try {
      const cogMeta = await getCogMeta(photo.cog_key)
      const { bands, nodata, overviews } = cogMeta

      // Select the finest overview whose pixel resolution is ≤ 2× the tile's
      // target metres-per-pixel. This avoids loading the full-res raster for
      // zoomed-out tiles (which would exhaust memory for high-res imagery).
      const targetMpp = tileSize / 256
      let ov = overviews[overviews.length - 1]  // coarsest fallback
      for (let i = overviews.length - 1; i >= 0; i--) {
        if (Math.abs(overviews[i].resolution[0]) <= targetMpp * 2) {
          ov = overviews[i]
          break
        }
      }

      const [origX, origY] = ov.origin
      const [xRes,  yRes]  = ov.resolution  // yRes < 0 flips y direction

      // Convert tile bbox (EPSG:3857 m) → pixel window in the selected overview.
      const pixLeft   = Math.round((xMin - origX) / xRes)
      const pixRight  = Math.round((xMax - origX) / xRes)
      const pixTop    = Math.round((yMax - origY) / yRes)
      const pixBottom = Math.round((yMin - origY) / yRes)

      // Clamp to the overview's actual pixel extent.  Without this, tiles that
      // contain the entire image produce window sizes in the billions, causing
      // geotiff.js to attempt impossibly large buffer allocations.
      const cLeft   = Math.max(0, pixLeft)
      const cRight  = Math.min(ov.width,  pixRight)
      const cTop    = Math.max(0, pixTop)
      const cBottom = Math.min(ov.height, pixBottom)

      if (cRight <= cLeft || cBottom <= cTop) {
        return res.end(await emptyTile())
      }

      // Compute the clamped region's position and size inside the 256×256 output tile.
      const tW   = pixRight - pixLeft
      const tH   = pixBottom - pixTop
      const outW = Math.max(1, Math.round(256 * (cRight  - cLeft) / tW))
      const outH = Math.max(1, Math.round(256 * (cBottom - cTop)  / tH))
      const outX = Math.round(256 * (cLeft - pixLeft) / tW)
      const outY = Math.round(256 * (cTop  - pixTop)  / tH)

      const rasters = await ov.image.readRasters({
        window: [cLeft, cTop, cRight, cBottom],
        width:  outW,
        height: outH,
        interleave: true,
        fillValue: 0,
      })

      const raw     = toRGBA(rasters as unknown as ArrayLike<number> & { BYTES_PER_ELEMENT: number }, bands, nodata)
      const partial = await sharp(raw, { raw: { width: outW, height: outH, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer()

      if (outW === 256 && outH === 256) {
        // Common case: the tile maps 1-to-1 onto a full 256×256 output
        png = partial
      } else {
        // Partial coverage: composite the sub-image onto a transparent 256×256 canvas
        png = await sharp({
          create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        }).composite([{ input: partial, left: outX, top: outY }]).png({ compressionLevel: 1 }).toBuffer()
      }
    } catch (err) {
      console.error(`[tile ${id}/${tz}/${tx}/${ty}] raster read failed:`, err instanceof Error ? err.message : err)
      // Invalidate cache on error so next request retries a fresh URL
      cogMetaCache.delete(photo.cog_key)
      png = await emptyTile()
    }

    res.end(png)
  } catch (err) { next(err) }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

interface OrthoRow extends Record<string, unknown> {
  id: string
  name: string
  status: string
  cog_key: string | null
  file_key: string | null
  bounds_west:  number | null
  bounds_south: number | null
  bounds_east:  number | null
  bounds_north: number | null
  zoom_min: number
  zoom_max: number
  error_message: string | null
  updated_at: string
}

let _emptyTile: Buffer | null = null
async function emptyTile(): Promise<Buffer> {
  if (!_emptyTile) {
    _emptyTile = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png({ compressionLevel: 1 }).toBuffer()
  }
  return _emptyTile
}

function lon2merc(lon: number): number {
  return lon * EARTH_HALF / 180
}

function lat2merc(lat: number): number {
  return Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * EARTH_HALF / 180
}

function toRGBA(
  data: ArrayLike<number> & { BYTES_PER_ELEMENT: number },
  bands: number,
  nodata: number | null,
): Buffer {
  const pixels = 256 * 256
  const scale  = data.BYTES_PER_ELEMENT === 2 ? 256 : 1  // 16-bit → 8-bit
  const rgba   = Buffer.alloc(pixels * 4)
  // gdalwarp fills OOB pixels with 0 even without explicit -dstnodata
  const nd = nodata ?? 0

  for (let i = 0; i < pixels; i++) {
    const b = i * bands
    if (bands === 1) {
      const v = data[b] / scale
      rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = v
      rgba[i*4+3] = data[b] === nd ? 0 : 255
    } else if (bands === 2) {
      const v = data[b] / scale
      rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = v
      rgba[i*4+3] = data[b+1] / scale
    } else if (bands === 3) {
      rgba[i*4]   = data[b]   / scale
      rgba[i*4+1] = data[b+1] / scale
      rgba[i*4+2] = data[b+2] / scale
      // All-zero pixels at tile edges are gdalwarp fill (OOB), not valid black pixels
      rgba[i*4+3] = (data[b] === nd && data[b+1] === nd && data[b+2] === nd) ? 0 : 255
    } else {
      rgba[i*4]   = data[b]   / scale
      rgba[i*4+1] = data[b+1] / scale
      rgba[i*4+2] = data[b+2] / scale
      rgba[i*4+3] = data[b+3] / scale
    }
  }

  return rgba
}

function runProcess(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, env ? { env: { ...process.env, ...env } } : undefined)
    let stdout = '', stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${cmd} failed (exit ${code}): ${stderr.slice(0, 600)}`))
    })
    proc.on('error', (e: NodeJS.ErrnoException) => {
      reject(new Error(`${cmd} not found — install gdal-bin on the server (${e.message})`))
    })
  })
}

async function processOrthophoto(id: string, fileKey: string, cogReady = false): Promise<void> {
  await db.query(
    `UPDATE orthophotos SET status = 'processing', updated_at = datetime('now') WHERE id = $1`,
    [id],
  )

  const tmp     = tmpdir()
  const cogPath = join(tmp, `orth_${id}_cog.tif`)
  const fileUrl = await presignDownload(fileKey)

  const gdalEnv = {
    GDAL_CACHEMAX:     '128',
    GDAL_HTTP_TIMEOUT: '180',
  }

  try {
    let cogKey: string

    if (cogReady) {
      // File is already an EPSG:3857 COG — skip gdalwarp entirely
      cogKey = fileKey
    } else {
      // Single-pass: reproject + COG output (no large intermediate file)
      // Note: COG driver builds overviews automatically — don't pass OVERVIEW_LEVEL
      // (GDAL warns about it and recent versions can error).
      await runProcess('gdalwarp', [
        '-t_srs', 'EPSG:3857',
        '-r',     'bilinear',
        '-of',    'COG',
        '-co',    'COMPRESS=LZW',
        '-co',    'BIGTIFF=IF_SAFER',
        '-wm',    '128',
        `/vsicurl/${fileUrl}`,
        cogPath,
      ], gdalEnv)
      cogKey = `orthophotos/${id}/cog.tif`
      await uploadFile(cogKey, cogPath, 'image/tiff')
    }

    // Get WGS84 bounds via gdalinfo
    const infoTarget = cogReady ? `/vsicurl/${fileUrl}` : cogPath
    const infoJson   = await runProcess('gdalinfo', ['-json', infoTarget], gdalEnv)
    const info = JSON.parse(infoJson) as { wgs84Extent?: { coordinates: number[][][] } }
    const coords = info.wgs84Extent?.coordinates?.[0] ?? []
    const lons   = coords.map((c) => c[0])
    const lats   = coords.map((c) => c[1])
    const boundsWest  = lons.length ? Math.min(...lons) : null
    const boundsEast  = lons.length ? Math.max(...lons) : null
    const boundsSouth = lats.length ? Math.min(...lats) : null
    const boundsNorth = lats.length ? Math.max(...lats) : null

    // Derive zoom_max from pixel resolution
    const cogUrl  = await presignDownload(cogKey)
    const tiff    = await fromUrl(cogUrl)
    const image   = await tiff.getImage()
    const [xRes]  = image.getResolution()
    const zoomMax = Math.max(0, Math.min(22,
      Math.round(Math.log2((EARTH_HALF * 2) / (256 * Math.abs(xRes)))),
    ))

    await db.query(
      `UPDATE orthophotos SET
         status = 'ready', cog_key = $1,
         bounds_west = $2, bounds_south = $3, bounds_east = $4, bounds_north = $5,
         zoom_max = $6, updated_at = datetime('now')
       WHERE id = $7`,
      [cogKey, boundsWest, boundsSouth, boundsEast, boundsNorth, zoomMax, id],
    )
  } finally {
    if (!cogReady) await unlink(cogPath).catch(() => { /* already gone */ })
  }
}

// Pre-loads COG metadata for all ready orthophotos at server startup so the
// first tile request is fast instead of waiting ~10s for TIFF header reads.
export async function warmupOrthophotos(): Promise<void> {
  const { rows } = await db.query<{ cog_key: string }>(
    "SELECT cog_key FROM orthophotos WHERE status = 'ready' AND cog_key IS NOT NULL",
  )
  if (rows.length === 0) return
  console.log(`[cog warmup] warming ${rows.length} orthophoto(s)`)
  for (const { cog_key } of rows) {
    getCogMeta(cog_key).catch((err: unknown) => {
      console.error('[cog warmup] failed:', cog_key.split('/').pop(), err instanceof Error ? err.message : err)
    })
  }
}

export default router
