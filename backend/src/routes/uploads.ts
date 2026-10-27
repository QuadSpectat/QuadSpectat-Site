import { Router, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { presignUpload, presignDownload, listPrefix, makePublicRead, publicUrl } from '../s3'
import { db } from '../db'
import { env } from '../env'
import { optionalAuth } from '../middleware/optionalAuth'
import { requireAuth } from '../middleware/auth'
import { shareGrantsModel } from '../shareAccess'

const router = Router()

// POST /api/uploads/presign
// Body: { filename: string, contentType: string }
// Returns: { key: string, url: string }
//
// Workflow: client gets this URL, PUTs the file directly to Spaces,
// then calls POST /api/models with the returned key.
router.post('/presign', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
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

// ── 3D Tiles upload (many files under one prefix) ────────────────────────────
// A tileset is a tileset.json plus hundreds/thousands of tile files that reference each other by
// relative path, so they must live side by side under one public prefix. The browser uploads each
// file straight to Spaces with a presigned PUT (nothing passes through the 512 MB Fly machine),
// then calls /tileset/finalize.
const MAX_BATCH = 500
const SAFE_PATH = /^[A-Za-z0-9._()+@=,\- ]+(\/[A-Za-z0-9._()+@=,\- ]+)*$/

// POST /api/uploads/tileset/presign
// Body: { uploadId?: string, files: [{ path, contentType }] }   (max 500 per call; reuse uploadId for further batches)
// Returns: { uploadId, prefix, files: [{ path, key, url }] }  — PUT each file to its url with header Content-Type
router.post('/tileset/presign', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uploadId, files } = req.body as { uploadId?: unknown; files?: unknown }
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_BATCH) {
      res.status(400).json({ error: `files must be an array of 1-${MAX_BATCH} entries` }); return
    }
    const id = typeof uploadId === 'string' && /^[0-9a-f-]{36}$/.test(uploadId) ? uploadId : randomUUID()
    const prefix = `tilesets/${id}/`
    const out: { path: string; key: string; url: string }[] = []
    for (const f of files as { path?: unknown; contentType?: unknown }[]) {
      if (typeof f.path !== 'string' || !SAFE_PATH.test(f.path) || f.path.split('/').includes('..')) {
        res.status(400).json({ error: `Unsupported file path: ${String(f.path)}` }); return
      }
      const ct = typeof f.contentType === 'string' && f.contentType ? f.contentType : 'application/octet-stream'
      const key = prefix + f.path
      out.push({ path: f.path, key, url: await presignUpload(key, ct, 'public-read') })
    }
    res.json({ uploadId: id, prefix, files: out, expiresIn: env.PRESIGN_EXPIRY_SECONDS })
  } catch (err) { next(err) }
})

// POST /api/uploads/tileset/finalize
// Body: { uploadId: string, expectedFiles?: number }
// Verifies a root tileset.json/Cesium.json is at the root of the prefix, that the files are publicly readable (fixing
// the ACL if Spaces ignored it), and returns { external_url, file_size, count } for POST /api/models.
router.post('/tileset/finalize', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uploadId, expectedFiles } = req.body as { uploadId?: unknown; expectedFiles?: unknown }
    if (typeof uploadId !== 'string' || !/^[0-9a-f-]{36}$/.test(uploadId)) {
      res.status(400).json({ error: 'uploadId is required' }); return
    }
    const prefix = `tilesets/${uploadId}/`
    const objs = await listPrefix(prefix)
    // Root document: tileset.json, else Cesium.json (ContextCapture), else the only .json at the root
    const rootJsons = objs.map((o) => o.key.slice(prefix.length)).filter((k) => !k.includes('/') && k.toLowerCase().endsWith('.json'))
    const rootName = rootJsons.find((k) => k === 'tileset.json') ?? rootJsons.find((k) => k.toLowerCase() === 'cesium.json')
      ?? (rootJsons.length === 1 ? rootJsons[0] : undefined)
    if (!rootName) {
      res.status(400).json({ error: 'No tileset.json (or Cesium.json) was found at the root of the upload' }); return
    }
    if (typeof expectedFiles === 'number' && objs.length < expectedFiles) {
      res.status(400).json({ error: `Only ${objs.length} of ${expectedFiles} files arrived in storage; upload again` }); return
    }
    const url = publicUrl(prefix + rootName)
    let warning: string | undefined
    let ok = (await fetch(url, { method: 'HEAD' }).catch(() => null))?.ok === true
    if (!ok) {
      // ACL on the presigned PUT was ignored: set it per object, then re-check.
      for (let i = 0; i < objs.length; i += 8) {
        await Promise.all(objs.slice(i, i + 8).map((o) => makePublicRead(o.key)))
      }
      ok = (await fetch(url, { method: 'HEAD' }).catch(() => null))?.ok === true
      if (!ok) warning = 'Uploaded, but the tileset is not publicly readable at ' + url + ' - check the bucket (File Listing/ACL) and CORS.'
    }
    res.json({ external_url: url, file_size: objs.reduce((a, o) => a + o.size, 0), count: objs.length, warning })
  } catch (err) { next(err) }
})

// GET /api/uploads/:id/download
// For CDN-hosted models (3D Tiles etc.) returns external_url directly.
// For Spaces-hosted files returns a short-lived presigned GET URL.
router.get('/:id/download', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query(
      'SELECT file_key, external_url, is_public_demo FROM models WHERE id = $1',
      [req.params.id],
    )
    if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return }
    const isDemo = !!rows[0].is_public_demo
    // Allowed: admin, a model flagged as the public demo, or a valid (unexpired) share link for exactly this model (?share=<token>)
    if (!req.isAdmin && !isDemo && !(await shareGrantsModel(req.query.share, req.params.id))) {
      res.status(404).json({ error: 'Not found' }); return
    }

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
