import { Router, Request, Response, NextFunction } from 'express'
import { randomBytes } from 'node:crypto'
import { db } from '../db'

const router = Router()

// POST /api/share
// Body: { model_id: string, label?: string }
// Returns: { token, url }
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id, label } = req.body as Record<string, unknown>
    if (typeof model_id !== 'string' || !model_id) {
      res.status(400).json({ error: 'model_id is required' })
      return
    }

    // Verify model exists
    const { rows: modelRows } = await db.query(
      'SELECT id FROM models WHERE id = $1',
      [model_id],
    )
    if (!modelRows[0]) {
      res.status(404).json({ error: 'Model not found' })
      return
    }

    const token = randomBytes(24).toString('hex')  // 48-char hex token

    await db.query(
      'INSERT INTO share_links (token, model_id, label) VALUES ($1, $2, $3)',
      [token, model_id, label ?? null],
    )

    res.status(201).json({ token, path: `/v/${token}` })
  } catch (err) {
    next(err)
  }
})

// GET /api/share/:token
// Public — returns the model for a given share token
router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query(
      `SELECT m.* FROM models m
       JOIN share_links s ON s.model_id = m.id
       WHERE s.token = $1`,
      [req.params.token],
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'Share link not found or expired' })
      return
    }
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

// GET /api/share?model_id=...
// List all share links for a model
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id } = req.query as Record<string, string>
    if (!model_id) { res.status(400).json({ error: 'model_id query param required' }); return }
    const { rows } = await db.query(
      'SELECT token, label, created_at FROM share_links WHERE model_id = $1 ORDER BY created_at DESC',
      [model_id],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// DELETE /api/share/:token
router.delete('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db.query('DELETE FROM share_links WHERE token = $1', [req.params.token])
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
