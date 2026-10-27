import { Router, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { optionalAuth } from '../middleware/optionalAuth'
import { requireAuth } from '../middleware/auth'
import { shareGrantsModel } from '../shareAccess'

const router = Router()
const MAX_VIEWS_PER_MODEL = 20

async function parentModelIsPublic(modelId: string): Promise<boolean> {
  const { rows } = await db.query('SELECT is_public_demo FROM models WHERE id = $1', [modelId])
  return !!rows[0]?.is_public_demo
}

interface ViewRow { id: string; model_id: string; name: string; camera: string; position: number; created_at: string }

function toSavedView(r: ViewRow) {
  let camera: unknown = null
  try { camera = JSON.parse(r.camera) } catch { /* corrupt row: leave null */ }
  return { id: r.id, model_id: r.model_id, name: r.name, camera, position: r.position, created_at: r.created_at }
}

const RANGES: Record<string, [number, number]> = {
  lon: [-180, 180],
  lat: [-90, 90],
  height: [-1000, 1e7],
  heading: [-1e4, 1e4],
  pitch: [-1e4, 1e4],
  roll: [-1e4, 1e4],
}

function parseCamera(input: unknown): Record<string, number> | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = src[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return null
    out[k] = v
  }
  return out
}

// GET /api/views?model_id=X&share=TOKEN
router.get('/', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id, share } = req.query as Record<string, string | undefined>
    if (!model_id || typeof model_id !== 'string') { res.status(400).json({ error: 'model_id required' }); return }
    const allowed =
      req.isAdmin ||
      (await shareGrantsModel(share, model_id)) ||
      (await parentModelIsPublic(model_id))
    if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return }
    const { rows } = await db.query<ViewRow>(
      'SELECT * FROM saved_views WHERE model_id = $1 ORDER BY position ASC, created_at ASC',
      [model_id],
    )
    res.json(rows.map(toSavedView))
  } catch (err) {
    next(err)
  }
})

// POST /api/views   Body: { model_id, name, camera }
router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id, name, camera } = (req.body ?? {}) as Record<string, unknown>
    if (typeof model_id !== 'string' || !model_id) { res.status(400).json({ error: 'model_id required' }); return }
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed || trimmed.length > 60) { res.status(400).json({ error: 'name must be 1-60 characters' }); return }
    const cam = parseCamera(camera)
    if (!cam) { res.status(400).json({ error: 'invalid camera' }); return }

    const model = await db.query('SELECT id FROM models WHERE id = $1', [model_id])
    if (!model.rows[0]) { res.status(404).json({ error: 'Model not found' }); return }

    const count = await db.query('SELECT COUNT(*) AS n FROM saved_views WHERE model_id = $1', [model_id])
    const n = Number((count.rows[0] as { n: number }).n)
    if (n >= MAX_VIEWS_PER_MODEL) {
      res.status(409).json({ error: `At most ${MAX_VIEWS_PER_MODEL} views per model` }); return
    }

    const id = randomUUID()
    await db.query(
      'INSERT INTO saved_views (id, model_id, name, camera, position) VALUES ($1,$2,$3,$4,$5)',
      [id, model_id, trimmed, JSON.stringify(cam), n],
    )
    const { rows } = await db.query<ViewRow>('SELECT * FROM saved_views WHERE id = $1', [id])
    res.status(201).json(toSavedView(rows[0]))
  } catch (err) {
    next(err)
  }
})

// DELETE /api/views/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query('DELETE FROM saved_views WHERE id = $1 RETURNING *', [req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
