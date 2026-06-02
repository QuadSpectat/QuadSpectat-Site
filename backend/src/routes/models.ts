import { Router, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { deleteObject } from '../s3'

const router = Router()

// GET /api/models?limit=50&offset=0
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 100)
    const offset = Number(req.query.offset ?? 0)
    const { rows } = await db.query(
      'SELECT * FROM models ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// GET /api/models/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query('SELECT * FROM models WHERE id = $1', [req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return }
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

// POST /api/models
// Body: { name, file_key, file_size?, file_type?, description?,
//         longitude?, latitude?, altitude?, heading?, pitch?, roll?, scale? }
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      asset_name, name, file_key, file_size, file_type, description,
      longitude, latitude, altitude, heading, pitch, roll, scale,
      model_type, external_url, coordinate_system, geoid_offset, show_watermark, watermark_text,
    } = req.body as Record<string, unknown>

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
          model_type, external_url, coordinate_system, geoid_offset, show_watermark, watermark_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
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
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name, description,
      longitude, latitude, altitude, heading, pitch, roll, scale,
      coordinate_system, geoid_offset, watermark_text,
    } = req.body as Record<string, unknown>

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
           updated_at         = NOW()
       WHERE id = $13
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
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
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
