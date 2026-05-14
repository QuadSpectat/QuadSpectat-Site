import { Router, Request, Response, NextFunction } from 'express'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { presignUpload, presignDownload, deleteObject, uploadObject } from '../s3'

const router = Router()

// POST /api/layers/upload?filename=X&model_id=Y  (raw binary body, proxied to Spaces)
// express.raw() buffers the body as a Buffer on req.body — works even after express.json()
router.post('/upload',
  express.raw({ type: '*/*', limit: '500mb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { filename, model_id } = req.query as Record<string, string>
      if (!filename || !model_id) {
        res.status(400).json({ error: 'filename and model_id required' }); return
      }
      const ext = filename.split('.').pop() ?? 'kml'
      const key = `layers/${model_id}/${randomUUID()}.${ext}`
      const contentType = (req.headers['content-type'] as string) || 'application/octet-stream'
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)

      await uploadObject(key, body, contentType)

      const { rows } = await db.query(
        `INSERT INTO layers (id, model_id, name, file_key, file_type) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [randomUUID(), model_id, filename, key, ext],
      )
      res.status(201).json(rows[0])
    } catch (err) {
      next(err)
    }
  },
)

// POST /api/layers/presign
// Body: { filename, contentType, model_id }
router.post('/presign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { filename, contentType, model_id } = req.body as Record<string, unknown>
    if (typeof filename !== 'string' || typeof contentType !== 'string' || typeof model_id !== 'string') {
      res.status(400).json({ error: 'filename, contentType, model_id required' })
      return
    }
    const ext = filename.split('.').pop() ?? 'kml'
    const key = `layers/${model_id}/${randomUUID()}.${ext}`
    const url = await presignUpload(key, contentType)
    res.json({ key, url })
  } catch (err) {
    next(err)
  }
})

// POST /api/layers
// Body: { model_id, name, file_key, file_type }
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id, name, file_key, file_type } = req.body as Record<string, unknown>
    if (!model_id || !name || !file_key) {
      res.status(400).json({ error: 'model_id, name, file_key required' })
      return
    }
    const { rows } = await db.query(
      `INSERT INTO layers (id, model_id, name, file_key, file_type)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [randomUUID(), model_id, name, file_key, file_type ?? 'kml'],
    )
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
})

// GET /api/layers?model_id=...
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { model_id } = req.query as Record<string, string>
    if (!model_id) { res.status(400).json({ error: 'model_id required' }); return }
    const { rows } = await db.query(
      'SELECT * FROM layers WHERE model_id = $1 ORDER BY created_at ASC',
      [model_id],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// GET /api/layers/:id/download  — presigned URL for the layer file
router.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query('SELECT file_key FROM layers WHERE id = $1', [req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return }
    const url = await presignDownload((rows[0] as { file_key: string }).file_key)
    res.json({ url })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/layers/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query('DELETE FROM layers WHERE id = $1 RETURNING *', [req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return }
    deleteObject((rows[0] as { file_key: string }).file_key).catch(console.error)
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

// PATCH /api/layers/:id/visible  — toggle visibility stored in DB
router.patch('/:id/visible', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { visible } = req.body as { visible: boolean }
    await db.query('UPDATE layers SET visible = $1 WHERE id = $2', [visible ? 1 : 0, req.params.id])
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
