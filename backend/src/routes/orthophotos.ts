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

interface CogMeta {
  image:      GeoTIFFImage
  origin:     number[]
  resolution: number[]
  bands:      number
  nodata:     number | null
  imageW:     number
  imageH:     number
  expiry:     number
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

    // COG IFDs are not always ordered full-res first — find the largest image.
    let image = await tiff.getImage(0)
    let maxPx = image.getWidth() * image.getHeight()
    for (let i = 1; i < imageCount; i++) {
      const img = await tiff.getImage(i)
      const px  = img.getWidth() * img.getHeight()
      if (px > maxPx) { maxPx = px; image = img }
    }

    const meta: CogMeta = {
      image,
      origin:     image.getOrigin(),
      resolution: image.getResolution(),
      bands:      image.getSamplesPerPixel(),
      nodata:     image.getGDALNoData(),
      imageW:     image.getWidth(),
      imageH:     image.getHeight(),
      expiry:     Date.now() + 50 * 60 * 1000,
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
    const { name, description, raw_key, original_format, cog_ready } = req.body as Record<string, unknown>
    if (typeof name !== 'string' || !name) return res.status(400).json({ error: 'name is required' })
    if (typeof raw_key !== 'string' || !raw_key) return res.status(400).json({ error: 'raw_key is required' })

    const id        = randomUUID()
    const fmt       = typeof original_format === 'string' ? original_format : 'unknown'
    const desc      = typeof description === 'string' ? description : null
    const cogReady  = cog_ready === true

    const { rows } = await db.query<OrthoRow>(
      `INSERT INTO orthophotos (id, name, description, file_key, original_format, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
      [id, name, desc, raw_key, fmt],
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
      const { filename } = req.query as Record<string, string>
      if (!filename) return res.status(400).json({ error: 'filename required' })

      const ext = filename.split('.').pop()?.toLowerCase() ?? 'tif'
      const id = randomUUID()
      const fileKey = `orthophotos/${id}/original.${ext}`
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)

      await uploadObject(fileKey, body, 'image/tiff')

      const { rows } = await db.query<OrthoRow>(
        `INSERT INTO orthophotos (id, name, file_key, original_format, status)
         VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
        [id, filename, fileKey, ext],
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

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=3600')

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
      const { image, origin: [origX, origY], resolution: [xRes, yRes], bands, nodata, imageW, imageH } =
        await getCogMeta(photo.cog_key)

      // Convert tile bbox (EPSG:3857 m) → pixel window via the image's GeoTransform.
      // Uses IFD 0 directly — bypasses geotiff.js overview auto-selection which
      // miscomputes pixel offsets inside overview IFDs, causing seams/wrong content.
      const pixLeft   = Math.round((xMin - origX) / xRes)
      const pixRight  = Math.round((xMax - origX) / xRes)
      const pixTop    = Math.round((yMax - origY) / yRes)  // yRes < 0 flips direction
      const pixBottom = Math.round((yMin - origY) / yRes)

      // Skip tiles entirely outside the image extent
      if (pixRight <= 0 || pixLeft >= imageW || pixBottom <= 0 || pixTop >= imageH) {
        return res.end(await emptyTile())
      }

      const rasters = await image.readRasters({
        window: [pixLeft, pixTop, pixRight, pixBottom],
        width: 256,
        height: 256,
        interleave: true,
        fillValue: 0,
      })

      const raw = toRGBA(rasters as unknown as ArrayLike<number> & { BYTES_PER_ELEMENT: number }, bands, nodata)
      png = await sharp(raw, { raw: { width: 256, height: 256, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer()
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
      await runProcess('gdalwarp', [
        '-t_srs', 'EPSG:3857',
        '-r',     'bilinear',
        '-of',    'COG',
        '-co',    'COMPRESS=LZW',
        '-co',    'OVERVIEW_LEVEL=AUTO',
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

export default router
