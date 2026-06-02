import { Router, Request, Response, NextFunction } from 'express'
import { randomBytes } from 'node:crypto'
import { db } from '../db'

const router = Router()

const EDITABLE_FIELDS = ['longitude', 'latitude', 'altitude', 'heading', 'pitch', 'roll', 'scale'] as const
type EditableField = typeof EDITABLE_FIELDS[number]

// POST /api/share
// Body: { model_id?: string, orthophoto_id?: string, label?: string, can_edit?: boolean }
// Exactly one of model_id / orthophoto_id must be supplied.
// can_edit is honoured only for models.
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id, orthophoto_id, label, can_edit } = req.body as Record<string, unknown>
    const mId = typeof model_id      === 'string' && model_id      ? model_id      : null
    const oId = typeof orthophoto_id === 'string' && orthophoto_id ? orthophoto_id : null
    if ((mId === null) === (oId === null)) {
      res.status(400).json({ error: 'Exactly one of model_id or orthophoto_id is required' })
      return
    }

    if (mId !== null) {
      const { rows } = await db.query('SELECT id FROM models WHERE id = $1', [mId])
      if (!rows[0]) { res.status(404).json({ error: 'Model not found' }); return }
    } else {
      const { rows } = await db.query('SELECT id FROM orthophotos WHERE id = $1', [oId])
      if (!rows[0]) { res.status(404).json({ error: 'Orthophoto not found' }); return }
    }

    const token      = randomBytes(24).toString('hex')
    // can_edit only meaningful for model shares — recipients can't "edit" an orthophoto
    const canEditInt = (mId !== null && can_edit) ? 1 : 0

    await db.query(
      'INSERT INTO share_links (token, model_id, orthophoto_id, label, can_edit) VALUES ($1, $2, $3, $4, $5)',
      [token, mId, oId, label ?? null, canEditInt],
    )

    res.status(201).json({ token, path: `/v/${token}` })
  } catch (err) {
    next(err)
  }
})

// GET /api/share/:token
// Public — returns either { kind: 'model', model, can_edit } or
// { kind: 'orthophoto', orthophoto, can_edit }
router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: linkRows } = await db.query<{
      model_id: string | null
      orthophoto_id: string | null
      can_edit: number
    }>(
      'SELECT model_id, orthophoto_id, can_edit FROM share_links WHERE token = $1',
      [req.params.token],
    )
    const link = linkRows[0]
    if (!link) { res.status(404).json({ error: 'Share link not found or expired' }); return }

    if (link.model_id) {
      const { rows } = await db.query<Record<string, unknown>>(
        'SELECT * FROM models WHERE id = $1',
        [link.model_id],
      )
      if (!rows[0]) { res.status(404).json({ error: 'Model no longer exists' }); return }
      res.json({ kind: 'model', model: rows[0], can_edit: Boolean(link.can_edit) })
      return
    }

    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM orthophotos WHERE id = $1',
      [link.orthophoto_id],
    )
    if (!rows[0]) { res.status(404).json({ error: 'Orthophoto no longer exists' }); return }
    res.json({ kind: 'orthophoto', orthophoto: rows[0], can_edit: false })
  } catch (err) {
    next(err)
  }
})

// GET /api/share?model_id=...   or   ?orthophoto_id=...
// Lists share links bound to that resource
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id, orthophoto_id } = req.query as Record<string, string>
    if (model_id) {
      const { rows } = await db.query<Record<string, unknown>>(
        'SELECT token, label, can_edit, created_at FROM share_links WHERE model_id = $1 ORDER BY created_at DESC',
        [model_id],
      )
      res.json(rows.map((r) => ({ ...r, can_edit: Boolean(r.can_edit) })))
      return
    }
    if (orthophoto_id) {
      const { rows } = await db.query<Record<string, unknown>>(
        'SELECT token, label, can_edit, created_at FROM share_links WHERE orthophoto_id = $1 ORDER BY created_at DESC',
        [orthophoto_id],
      )
      res.json(rows.map((r) => ({ ...r, can_edit: Boolean(r.can_edit) })))
      return
    }
    res.status(400).json({ error: 'model_id or orthophoto_id query param required' })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/share/:token/model — only valid for model share tokens
router.patch('/:token/model', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: linkRows } = await db.query<{ model_id: string | null; can_edit: number }>(
      'SELECT model_id, can_edit FROM share_links WHERE token = $1',
      [req.params.token],
    )
    const link = linkRows[0]
    if (!link)              { res.status(404).json({ error: 'Share link not found' }); return }
    if (!link.model_id)     { res.status(400).json({ error: 'This token is not a model share' }); return }
    if (!link.can_edit)     { res.status(403).json({ error: 'This link does not allow editing' }); return }

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
