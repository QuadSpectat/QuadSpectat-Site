import { Router, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { presignDownload, deleteObject, uploadObject, getObjectBuffer } from '../s3'
import { optionalAuth } from '../middleware/optionalAuth'
import { requireAuth } from '../middleware/auth'
import { shareGrantsModel } from '../shareAccess'
import { LAYER_LIMITS, SOURCE_CRS_OPTIONS } from '../layerLimits'
import { LayerError, validateLayer } from '../layerValidate'

const router = Router()

interface LayerRow {
  id: string; model_id: string; name: string; file_key: string; file_type: string
  visible: number; created_at: string; opacity: number; height_offset: number; clamp_mode: string
  source_crs: string | null; source_name: string | null; status: string; status_message: string | null
  sort_order: number; client_visible: number; feature_count: number | null; byte_size: number | null
  bbox: string | null; has_z: number
}

async function parentModelIsPublic(modelId: string): Promise<boolean> {
  const { rows } = await db.query('SELECT is_public_demo FROM models WHERE id = $1', [modelId])
  return !!rows[0]?.is_public_demo
}

/** What anyone but the owner may see of a layer: no storage key, source file name, CRS or error text. */
function publicLayer(r: LayerRow) {
  return {
    id: r.id, model_id: r.model_id, name: r.name, file_type: r.file_type, visible: r.visible,
    clamp_mode: r.clamp_mode, height_offset: r.height_offset, sort_order: r.sort_order,
    has_z: r.has_z, status: r.status === 'error' ? 'error' : 'ready',
  }
}

function shareToken(req: Request): string | undefined {
  return typeof req.query.share === 'string' ? req.query.share : undefined
}

/** Owner: everything. A share link for exactly this model: only client_visible layers. Public demo model: as before. */
async function readAccess(req: Request, modelId: string): Promise<'admin' | 'client' | 'public' | 'none'> {
  if (req.isAdmin) return 'admin'
  if (await shareGrantsModel(shareToken(req), modelId)) return 'client'
  if (await parentModelIsPublic(modelId)) return 'public'
  return 'none'
}

router.get('/limits', (_req, res) => {
  res.json({
    maxBytes: LAYER_LIMITS.maxBytes, warnFeatures: LAYER_LIMITS.warnFeatures, maxFeatures: LAYER_LIMITS.maxFeatures,
    extensions: LAYER_LIMITS.extensions, sourceCrs: SOURCE_CRS_OPTIONS,
  })
})

// POST /api/layers/upload?filename=X&model_id=Y[&source_crs=EPSG:2039]
// The raw body is parsed in index.ts BEFORE express.json() (see the comment there): a browser labels a .json file
// "application/json", and the JSON parser used to swallow the body so an empty file was stored.
router.post('/upload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { filename, model_id, source_crs } = req.query as Record<string, string | undefined>
    if (!filename || !model_id) { res.status(400).json({ error: 'filename and model_id required' }); return }
    const m = await db.query('SELECT id FROM models WHERE id = $1', [model_id])
    if (!m.rows[0]) { res.status(404).json({ error: 'Model not found' }); return }
    if (!Buffer.isBuffer(req.body)) {
      // Never store an empty object: a missing body is a visible error
      res.status(400).json({ error: 'The file arrived empty (no body received). Nothing was uploaded; pick the file again.' }); return
    }
    const info = await validateLayer(filename, req.body, source_crs)
    const key = `layers/${model_id}/${randomUUID()}.${info.ext}`
    await uploadObject(key, info.body, info.contentType)

    const count = await db.query('SELECT COUNT(*) AS n FROM layers WHERE model_id = $1', [model_id])
    const order = Number((count.rows[0] as { n: number }).n)
    // New 2D files drape onto the model; files that carry heights keep them (switchable per layer in the panel)
    const clamp = info.kind === 'czml' ? 'heights' : info.hasZ ? 'heights' : 'drape'
    const { rows } = await db.query(
      `INSERT INTO layers (id, model_id, name, file_key, file_type, source_name, source_crs, status, status_message,
                           sort_order, feature_count, byte_size, bbox, has_z, clamp_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [randomUUID(), model_id, filename, key, info.ext, filename, info.sourceCrs, 'ready',
        info.warnings.join(' ') || null, order, info.featureCount, info.body.length,
        info.bbox ? info.bbox.join(',') : null, info.hasZ ? 1 : 0, clamp],
    )
    res.status(201).json({ ...rows[0], warnings: info.warnings, reprojected: info.reprojected })
  } catch (err) {
    if (err instanceof LayerError) { res.status(err.status).json({ error: err.message }); return }
    next(err)
  }
})

// GET /api/layers?model_id=...[&share=<token>]
router.get('/', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id } = req.query as Record<string, string>
    if (!model_id) { res.status(400).json({ error: 'model_id required' }); return }
    const access = await readAccess(req, model_id)
    if (access === 'none') { res.json([]); return }
    const { rows } = await db.query<LayerRow>(
      'SELECT * FROM layers WHERE model_id = $1 ORDER BY sort_order ASC, created_at ASC',
      [model_id],
    )
    if (access === 'admin') { res.json(rows); return }
    const list = access === 'client' ? rows.filter((r) => r.client_visible === 1 && r.status !== 'error') : rows
    res.json(list.map(publicLayer))
  } catch (err) {
    next(err)
  }
})

// GET /api/layers/:id/download  — presigned URL for the layer file
router.get('/:id/download', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query<LayerRow>('SELECT * FROM layers WHERE id = $1', [req.params.id])
    const row = rows[0]
    if (!row) { res.status(404).json({ error: 'Not found' }); return }
    const access = await readAccess(req, row.model_id)
    const allowed = access === 'admin' || access === 'public' || (access === 'client' && row.client_visible === 1 && row.status !== 'error')
    if (!allowed) { res.status(404).json({ error: 'Not found' }); return }
    res.json({ url: await presignDownload(row.file_key) })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/layers/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query('DELETE FROM layers WHERE id = $1 RETURNING *', [req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return }
    deleteObject((rows[0] as { file_key: string }).file_key).catch(console.error)
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

const bit = (v: unknown): number | null => (v === true || v === 1 ? 1 : v === false || v === 0 ? 0 : null)

// PATCH /api/layers/:id  — the one writer, with an allowlist of fields (admin)
router.patch('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>
    const sets: string[] = []
    const vals: unknown[] = []
    const add = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v) }
    const bad = (m: string) => { res.status(400).json({ error: m }) }

    if ('visible' in b) { const v = bit(b.visible); if (v === null) return bad('visible must be true or false'); add('visible', v) }
    if ('client_visible' in b) { const v = bit(b.client_visible); if (v === null) return bad('client_visible must be true or false'); add('client_visible', v) }
    if ('height_offset' in b) {
      const n = Number(b.height_offset)
      if (!Number.isFinite(n) || Math.abs(n) > 1000) return bad('height_offset must be a number between -1000 and 1000 metres')
      add('height_offset', n)
    }
    if ('opacity' in b) {
      const n = Number(b.opacity)
      if (!Number.isFinite(n) || n < 0 || n > 1) return bad('opacity must be between 0 and 1')
      add('opacity', n)
    }
    if ('clamp_mode' in b) {
      if (b.clamp_mode !== 'drape' && b.clamp_mode !== 'heights') return bad('clamp_mode must be "drape" or "heights"')
      add('clamp_mode', b.clamp_mode)
    }
    if ('sort_order' in b) {
      const n = Number(b.sort_order)
      if (!Number.isInteger(n) || n < 0 || n > 100000) return bad('sort_order must be a whole number')
      add('sort_order', n)
    }
    if ('name' in b) {
      if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 200) return bad('name must be 1 to 200 characters')
      add('name', b.name.trim())
    }
    // The viewer reports a layer it could not draw, so the failure is visible to everyone and survives a reload
    if ('status' in b) {
      if (b.status !== 'ready' && b.status !== 'error') return bad('status must be "ready" or "error"')
      add('status', b.status)
      add('status_message', typeof b.status_message === 'string' ? b.status_message.slice(0, 500) : null)
    }
    if (!sets.length) return bad('nothing to update')
    const r = await db.query(`UPDATE layers SET ${sets.join(', ')} WHERE id = ? RETURNING *`, [...vals, req.params.id])
    if (!r.rows[0]) { res.status(404).json({ error: 'Not found' }); return }
    res.json(r.rows[0])
  } catch (err) {
    next(err)
  }
})

// POST /api/layers/:id/recheck  — re-read the stored file and refresh status / counts (the panel's Retry)
router.post('/:id/recheck', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query<LayerRow>('SELECT * FROM layers WHERE id = $1', [req.params.id])
    const row = rows[0]
    if (!row) { res.status(404).json({ error: 'Not found' }); return }
    let status = 'ready'
    let message: string | null = null
    let featureCount = row.feature_count
    let bbox = row.bbox
    let hasZ = row.has_z
    try {
      const body = await getObjectBuffer(row.file_key)
      const info = await validateLayer(`${row.id}.${row.file_type}`, body, undefined)
      message = info.warnings.join(' ') || null
      featureCount = info.featureCount
      bbox = info.bbox ? info.bbox.join(',') : null
      hasZ = info.hasZ ? 1 : 0
    } catch (e) {
      status = 'error'
      message = e instanceof LayerError ? e.message : 'The stored file could not be read.'
    }
    const r = await db.query(
      'UPDATE layers SET status = ?, status_message = ?, feature_count = ?, bbox = ?, has_z = ? WHERE id = ? RETURNING *',
      [status, message, featureCount, bbox, hasZ, row.id],
    )
    res.json(r.rows[0])
  } catch (err) {
    next(err)
  }
})

export default router
