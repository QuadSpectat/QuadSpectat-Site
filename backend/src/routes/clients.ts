import { Router, Request, Response, NextFunction } from 'express'
import { randomBytes } from 'node:crypto'
import { db } from '../db'
import { requireAuth } from '../middleware/auth'
import { effectiveExpiry, isExpired, oneYearFromNow } from '../shareAccess'

/**
 * Client pages: one private link per client that lists only the models / orthophotos assigned to them.
 * No client accounts. Each assigned asset gets its own share link (created here), which is what the viewer opens
 * and what authorises the file and tile requests for that one asset. Everything is valid for one year.
 */

type AssetKind = 'model' | 'orthophoto'
interface PageRow { token: string; name: string; note: string | null; created_at: string; expires_at: string | null; allow_google3d?: number }
interface AssetLink { share_token: string; position: number; model_id: string | null; orthophoto_id: string | null }

const newToken = () => randomBytes(24).toString('hex')

async function assetsOf(clientToken: string): Promise<AssetLink[]> {
  const { rows } = await db.query<AssetLink>(
    `SELECT a.share_token, a.position, s.model_id, s.orthophoto_id
       FROM client_page_assets a JOIN share_links s ON s.token = a.share_token
      WHERE a.client_token = $1 ORDER BY a.position, a.share_token`,
    [clientToken],
  )
  return rows
}

async function describe(a: AssetLink) {
  if (a.model_id) {
    const { rows } = await db.query<Record<string, unknown>>('SELECT id, name, description, model_type, asset_name FROM models WHERE id = $1', [a.model_id])
    const m = rows[0]
    return m ? { kind: 'model' as const, id: m.id as string, name: m.name as string, description: (m.description as string | null) ?? null, type: m.model_type as string, share_token: a.share_token } : null
  }
  const { rows } = await db.query<Record<string, unknown>>('SELECT id, name, description, status, asset_name FROM orthophotos WHERE id = $1', [a.orthophoto_id])
  const o = rows[0]
  return o ? { kind: 'orthophoto' as const, id: o.id as string, name: o.name as string, description: (o.description as string | null) ?? null, type: 'orthophoto', share_token: a.share_token } : null
}

async function addAsset(clientToken: string, kind: AssetKind, id: string, expiresAt: string, clientName: string, google3d = false): Promise<'added' | 'exists' | 'not_found'> {
  const table = kind === 'model' ? 'models' : 'orthophotos'
  const col = kind === 'model' ? 'model_id' : 'orthophoto_id'
  const exists = await db.query(`SELECT id FROM ${table} WHERE id = $1`, [id])
  if (!exists.rows[0]) return 'not_found'
  const current = await assetsOf(clientToken)
  if (current.some((a) => (kind === 'model' ? a.model_id : a.orthophoto_id) === id)) return 'exists'
  const shareToken = newToken()
  await db.query(
    `INSERT INTO share_links (token, ${col}, label, can_edit, expires_at, allow_google3d) VALUES ($1, $2, $3, 0, $4, $5)`,
    [shareToken, id, `Client page: ${clientName}`.slice(0, 120), expiresAt, google3d ? 1 : 0],
  )
  await db.query('INSERT INTO client_page_assets (client_token, share_token, position) VALUES ($1, $2, $3)', [clientToken, shareToken, current.length])
  return 'added'
}

async function pageSummary(p: PageRow) {
  const assets = (await Promise.all((await assetsOf(p.token)).map(describe))).filter(Boolean)
  return {
    token: p.token, name: p.name, note: p.note, created_at: p.created_at,
    expires_at: effectiveExpiry(p).toISOString(), expired: isExpired(p), path: `/c/${p.token}`, allow_google3d: Boolean(p.allow_google3d), assets,
  }
}

async function getPage(token: string): Promise<PageRow | null> {
  const { rows } = await db.query<PageRow>('SELECT token, name, note, created_at, expires_at, allow_google3d FROM client_pages WHERE token = $1', [token])
  return rows[0] ?? null
}

// ── Admin: /api/clients (login required) ─────────────────────────────────────
export const clientsAdmin = Router()
clientsAdmin.use(requireAuth)

clientsAdmin.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query<PageRow>('SELECT token, name, note, created_at, expires_at, allow_google3d FROM client_pages ORDER BY created_at DESC')
    res.json(await Promise.all(rows.map(pageSummary)))
  } catch (err) { next(err) }
})

// Body: { name, note?, assets?: [{ kind: 'model' | 'orthophoto', id }] }
clientsAdmin.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, note, assets } = req.body as { name?: unknown; note?: unknown; assets?: unknown }
    if (typeof name !== 'string' || !name.trim()) { res.status(400).json({ error: 'name is required' }); return }
    const list = Array.isArray(assets) ? assets : []
    const token = newToken()
    const expiresAt = oneYearFromNow()
    await db.query('INSERT INTO client_pages (token, name, note, expires_at) VALUES ($1, $2, $3, $4)', [token, name.trim().slice(0, 120), typeof note === 'string' ? note.slice(0, 500) : null, expiresAt])
    for (const a of list as Array<{ kind?: string; id?: string }>) {
      if ((a.kind === 'model' || a.kind === 'orthophoto') && typeof a.id === 'string') await addAsset(token, a.kind, a.id, expiresAt, name.trim(), false)
    }
    const page = await getPage(token)
    res.status(201).json(await pageSummary(page!))
  } catch (err) { next(err) }
})

clientsAdmin.patch('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await getPage(req.params.token)
    if (!page) { res.status(404).json({ error: 'Not found' }); return }
    const { name, note, allow_google3d } = req.body as { name?: unknown; note?: unknown; allow_google3d?: unknown }
    if (typeof allow_google3d === 'boolean') {
      // per client: the page and every link on it (links added later inherit it)
      await db.query('UPDATE client_pages SET allow_google3d = $1 WHERE token = $2', [allow_google3d ? 1 : 0, page.token])
      for (const a of await assetsOf(page.token)) await db.query('UPDATE share_links SET allow_google3d = $1 WHERE token = $2', [allow_google3d ? 1 : 0, a.share_token])
    }
    const newName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : page.name
    const newNote = typeof note === 'string' ? note.slice(0, 500) : page.note
    await db.query('UPDATE client_pages SET name = $1, note = $2 WHERE token = $3', [newName, newNote, page.token])
    res.json(await pageSummary((await getPage(page.token))!))
  } catch (err) { next(err) }
})

// Body: { kind, id }
clientsAdmin.post('/:token/assets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await getPage(req.params.token)
    if (!page) { res.status(404).json({ error: 'Not found' }); return }
    const { kind, id } = req.body as { kind?: string; id?: string }
    if ((kind !== 'model' && kind !== 'orthophoto') || typeof id !== 'string') { res.status(400).json({ error: 'kind (model|orthophoto) and id are required' }); return }
    const r = await addAsset(page.token, kind, id, effectiveExpiry(page).toISOString(), page.name, Boolean(page.allow_google3d))
    if (r === 'not_found') { res.status(404).json({ error: 'Asset not found' }); return }
    res.status(r === 'added' ? 201 : 200).json(await pageSummary(page))
  } catch (err) { next(err) }
})

clientsAdmin.delete('/:token/assets/:shareToken', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await getPage(req.params.token)
    if (!page) { res.status(404).json({ error: 'Not found' }); return }
    const mine = (await assetsOf(page.token)).some((a) => a.share_token === req.params.shareToken)
    if (!mine) { res.status(404).json({ error: 'Asset not on this page' }); return }
    await db.query('DELETE FROM share_links WHERE token = $1', [req.params.shareToken])   // cascades to client_page_assets
    res.json(await pageSummary(page))
  } catch (err) { next(err) }
})

// Renew: a fresh year for the page and every link on it.
clientsAdmin.post('/:token/renew', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await getPage(req.params.token)
    if (!page) { res.status(404).json({ error: 'Not found' }); return }
    const expiresAt = oneYearFromNow()
    await db.query('UPDATE client_pages SET expires_at = $1 WHERE token = $2', [expiresAt, page.token])
    for (const a of await assetsOf(page.token)) await db.query('UPDATE share_links SET expires_at = $1 WHERE token = $2', [expiresAt, a.share_token])
    res.json(await pageSummary((await getPage(page.token))!))
  } catch (err) { next(err) }
})

clientsAdmin.delete('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    for (const a of await assetsOf(req.params.token)) await db.query('DELETE FROM share_links WHERE token = $1', [a.share_token])
    await db.query('DELETE FROM client_pages WHERE token = $1', [req.params.token])
    res.status(204).send()
  } catch (err) { next(err) }
})

// ── Public: /api/client/:token (what the client's page loads) ────────────────
export const clientsPublic = Router()

clientsPublic.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const t = req.params.token
    const page = /^[0-9a-f]{20,80}$/.test(t) ? await getPage(t) : null
    if (!page) { res.status(404).json({ error: 'Page not found' }); return }
    if (isExpired(page)) { res.status(410).json({ error: 'This page has expired', name: page.name }); return }
    const assets = (await Promise.all((await assetsOf(page.token)).map(describe))).filter(Boolean)
    res.json({ name: page.name, note: page.note, expires_at: effectiveExpiry(page).toISOString(), assets })
  } catch (err) { next(err) }
})
