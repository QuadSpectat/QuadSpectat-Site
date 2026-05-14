import { Router, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { presignUpload, presignDownload } from '../s3'
import { db } from '../db'

const router = Router()

// POST /api/uploads/presign
// Body: { filename: string, contentType: string }
// Returns: { key: string, url: string }
//
// Workflow: client gets this URL, PUTs the file directly to Spaces,
// then calls POST /api/models with the returned key.
router.post('/presign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { filename, contentType } = req.body as Record<string, unknown>
    if (typeof filename !== 'string' || typeof contentType !== 'string') {
      res.status(400).json({ error: 'filename and contentType are required strings' })
      return
    }

    const ext = filename.split('.').pop() ?? 'bin'
    const key = `models/${randomUUID()}.${ext}`
    const url = await presignUpload(key, contentType)

    res.json({ key, url, expiresIn: Number(process.env.PRESIGN_EXPIRY_SECONDS ?? 3600) })
  } catch (err) {
    next(err)
  }
})

// GET /api/uploads/:id/download
// For CDN-hosted models (3D Tiles etc.) returns external_url directly.
// For Spaces-hosted files returns a short-lived presigned GET URL.
router.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query(
      'SELECT file_key, external_url FROM models WHERE id = $1',
      [req.params.id],
    )
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return }

    if (rows[0].external_url) {
      res.json({ url: rows[0].external_url as string })
      return
    }

    if (!rows[0].file_key) {
      res.status(400).json({ error: 'Model has no file or URL' })
      return
    }

    const url = await presignDownload(rows[0].file_key as string)
    res.json({ url })
  } catch (err) {
    next(err)
  }
})

export default router
