import { Router, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { deleteObject } from '../s3'
import { optionalAuth } from '../middleware/optionalAuth'
import { requireAuth } from '../middleware/auth'

const router = Router()

// Reject non-numeric / out-of-range pose values (null/undefined mean "not provided").
function poseError(b: Record<string, unknown>): string | null {
  const limits: Record<string, [number, number]> = {
    longitude: [-180, 180], latitude: [-90, 90], altitude: [-1e5, 1e5],
    heading: [-3600, 3600], pitch: [-3600, 3600], roll: [-3600, 3600], scale: [1e-9, 1e9], geoid_offset: [-1e3, 1e3], google_offset: [-1e3, 1e3], google_cutout_margin: [-100, 500],
  }
  for (const [k, [lo, hi]] of Object.entries(limits)) {
    const v = b[k]
    if (v === undefined || v === null) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return `${k} must be a number between ${lo} and ${hi}`
  }
  return null
}

/** true / 1 -> 1, false / 0 -> 0, anything else -> null (leave the column alone) */
const bit = (v: unknown): number | null => (v === true || v === 1 ? 1 : v === false || v === 0 ? 0 : null)

// GET /api/models?limit=50&offset=0
router.get('/', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 100)
    const offset = Number(req.query.offset ?? 0)
    if (req.isAdmin) {
      const { rows } = await db.query(
        'SELECT * FROM models ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset],
      )
      res.json(rows)
      return
    }
    // Anyone without a login sees only the models the owner flagged as the public demo
    const { rows } = await db.query(
      `SELECT * FROM models WHERE is_public_demo = 1
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// GET /api/models/:id
router.get('/:id', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query('SELECT * FROM models WHERE id = $1', [req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return }
    if (!req.isAdmin && !rows[0].is_public_demo) {
      res.status(404).json({ error: 'Not found' }); return
    }
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

// POST /api/models
// Body: { name, file_key, file_size?, file_type?, description?,
//         longitude?, latitude?, altitude?, heading?, pitch?, roll?, scale? }
router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      asset_name, name, file_key, file_size, file_type, description,
      longitude, latitude, altitude, heading, pitch, roll, scale,
      model_type, external_url, coordinate_system, geoid_offset, show_watermark, watermark_text,
      geoid_mode, is_public_demo,
    } = req.body as Record<string, unknown>

    const perr = poseError(req.body as Record<string, unknown>)
    if (perr) { res.status(400).json({ error: perr }); return }
    if (!asset_name || typeof asset_name !== 'string') {
      res.status(400).json({ error: 'asset_name is required' })
      return
    }
    if (!name || (!file_key && !external_url)) {
      res.status(400).json({ error: 'name and either file_key or external_url are required' })
      return
    }

    const { rows } = await db.query(
      `INSERT INTO models
         (id, asset_name, name, description, file_key, file_size, file_type,
          longitude, latitude, altitude, heading, pitch, roll, scale,
          model_type, external_url, coordinate_system, geoid_offset, show_watermark, watermark_text,
          geoid_mode, is_public_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        randomUUID(),
        asset_name,
        name,
        description ?? null,
        file_key ?? null,
        file_size ?? null,
        file_type ?? null,
        longitude ?? 0,
        latitude ?? 0,
        altitude ?? 0,
        heading ?? 0,
        pitch ?? 0,
        roll ?? 0,
        scale ?? 1,
        model_type ?? 'gltf',
        external_url ?? null,
        coordinate_system ?? 'unknown',
        geoid_offset ?? 0,
        show_watermark === false || show_watermark === 0 ? 0 : 1,
        typeof watermark_text === 'string' ? watermark_text : '',
        geoid_mode === true || geoid_mode === 1 ? 1 : 0,
        is_public_demo === true || is_public_demo === 1 ? 1 : 0,
      ],
    )
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
})

// PUT /api/models/:id
// Body: any subset of { name, description, longitude, latitude, altitude, heading, pitch, roll, scale }
// file_key is intentionally immutable — re-upload by deleting and recreating
router.put('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name, description,
      longitude, latitude, altitude, heading, pitch, roll, scale,
      coordinate_system, geoid_offset, watermark_text, geoid_mode, is_public_demo, google_offset, google_cutout, google_cutout_margin,
    } = req.body as Record<string, unknown>

    const perr = poseError(req.body as Record<string, unknown>)
    if (perr) { res.status(400).json({ error: perr }); return }
    const { rows } = await db.query(
      `UPDATE models
       SET name               = COALESCE($1,  name),
           description        = COALESCE($2,  description),
           longitude          = COALESCE($3,  longitude),
           latitude           = COALESCE($4,  latitude),
           altitude           = COALESCE($5,  altitude),
           heading            = COALESCE($6,  heading),
           pitch              = COALESCE($7,  pitch),
           roll               = COALESCE($8,  roll),
           scale              = COALESCE($9,  scale),
           coordinate_system  = COALESCE($10, coordinate_system),
           geoid_offset       = COALESCE($11, geoid_offset),
           watermark_text     = COALESCE($12, watermark_text),
           geoid_mode  = COALESCE($13, geoid_mode),
           is_public_demo     = COALESCE($14, is_public_demo),
           google_offset      = COALESCE($15, google_offset),
           google_cutout      = COALESCE($16, google_cutout),
           google_cutout_margin = COALESCE($17, google_cutout_margin),
           updated_at         = NOW()
       WHERE id = $18
       RETURNING *`,
      [
        name ?? null,
        description ?? null,
        longitude ?? null,
        latitude ?? null,
        altitude ?? null,
        heading ?? null,
        pitch ?? null,
        roll ?? null,
        scale ?? null,
        coordinate_system ?? null,
        geoid_offset ?? null,
        typeof watermark_text === 'string' ? watermark_text : null,
        bit(geoid_mode),
        bit(is_public_demo),
        typeof google_offset === 'number' ? google_offset : null,
        google_cutout === 0 || google_cutout === 1 || google_cutout === 2 ? google_cutout : null,
        typeof google_cutout_margin === 'number' ? google_cutout_margin : null,
        req.params.id,
      ],
    )
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return }
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

// DELETE /api/models/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('[DELETE /models/:id] id =', JSON.stringify(req.params.id))
    const { rows } = await db.query(
      'DELETE FROM models WHERE id = $1 RETURNING *',
      [req.params.id],
    )
    if (!rows[0]) {
      console.warn('[DELETE /models/:id] no row matched id', req.params.id)
      res.status(404).json({ error: 'Not found', id: req.params.id })
      return
    }

    // Best-effort S3 deletion — DB record is already gone
    deleteObject(rows[0].file_key as string).catch((err: unknown) => {
      console.error('S3 deletion failed for key:', rows[0].file_key, err)
    })

    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
