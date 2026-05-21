import { Router, Request, Response, NextFunction } from 'express'
import { randomBytes } from 'node:crypto'
import { db } from '../db'

const router = Router()

const EDITABLE_FIELDS = ['longitude', 'latitude', 'altitude', 'heading', 'pitch', 'roll', 'scale'] as const
type EditableField = typeof EDITABLE_FIELDS[number]

// POST /api/share
// Body: { model_id: string, label?: string, can_edit?: boolean }
// Returns: { token, path }
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id, label, can_edit } = req.body as Record<string, unknown>
    if (typeof model_id !== 'string' || !model_id) {
      res.status(400).json({ error: 'model_id is required' })
      return
    }

    const { rows: modelRows } = await db.query(
      'SELECT id FROM models WHERE id = $1',
      [model_id],
    )
    if (!modelRows[0]) {
      res.status(404).json({ error: 'Model not found' })
      return
    }

    const token      = randomBytes(24).toString('hex')
    const canEditInt = can_edit ? 1 : 0

    await db.query(
      'INSERT INTO share_links (token, model_id, label, can_edit) VALUES ($1, $2, $3, $4)',
      [token, model_id, label ?? null, canEditInt],
    )

    res.status(201).json({ token, path: `/v/${token}` })
  } catch (err) {
    next(err)
  }
})

// GET /api/share/:token
// Public — returns { model, can_edit } for a given share token
router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT m.*, s.can_edit FROM models m
       JOIN share_links s ON s.model_id = m.id
       WHERE s.token = $1`,
      [req.params.token],
    )
    if (!rows[0]) {
      res.status(404).json({ error: 'Share link not found or expired' })
      return
    }
    const { can_edit, ...model } = rows[0]
    res.json({ model, can_edit: Boolean(can_edit) })
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
    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT token, label, can_edit, created_at FROM share_links WHERE model_id = $1 ORDER BY created_at DESC',
      [model_id],
    )
    res.json(rows.map((r) => ({ ...r, can_edit: Boolean(r.can_edit) })))
  } catch (err) {
    next(err)
  }
})

// PATCH /api/share/:token/model
// Public endpoint authenticated via token ownership — update model position if can_edit
router.patch('/:token/model', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: linkRows } = await db.query<{ model_id: string; can_edit: number }>(
      'SELECT model_id, can_edit FROM share_links WHERE token = $1',
      [req.params.token],
    )
    const link = linkRows[0]
    if (!link) { res.status(404).json({ error: 'Share link not found' }); return }
    if (!link.can_edit) { res.status(403).json({ error: 'This link does not allow editing' }); return }

    const body = req.body as Partial<Record<EditableField, unknown>>
    const fields = EDITABLE_FIELDS.filter((f) => body[f] !== undefined && typeof body[f] === 'number')
    if (fields.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' })
      return
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ')
    const values     = [...fields.map((f) => body[f] as number), link.model_id]
    const idParam    = `$${fields.length + 1}`

    const { rows: updated } = await db.query(
      `UPDATE models SET ${setClauses}, updated_at = NOW() WHERE id = ${idParam} RETURNING *`,
      values,
    )
    res.json(updated[0] ?? null)
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
