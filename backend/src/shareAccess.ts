import { db } from './db'

/** Every share link and client page is valid for one year. */
export const LINK_DAYS = 365

export interface ShareRow {
  token: string
  model_id: string | null
  orthophoto_id: string | null
  can_edit: number
  allow_google3d?: number
  label: string | null
  created_at: string
  expires_at: string | null
}

/** SQLite stores 'YYYY-MM-DD HH:MM:SS' (UTC); our own writes are ISO strings. Accept both. */
export function parseUtc(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
}

export const oneYearFromNow = (): string => new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString()

/** The stored expiry, or (for links made before expiry existed) one year after they were created. */
export function effectiveExpiry(row: Pick<ShareRow, 'created_at' | 'expires_at'>): Date {
  if (row.expires_at) return parseUtc(row.expires_at)
  return new Date(parseUtc(row.created_at).getTime() + LINK_DAYS * 86_400_000)
}

export const isExpired = (row: Pick<ShareRow, 'created_at' | 'expires_at'>): boolean =>
  effectiveExpiry(row).getTime() <= Date.now()

export type ShareLookup =
  | { state: 'ok'; row: ShareRow }
  | { state: 'expired'; row: ShareRow }
  | { state: 'missing' }

export async function findShare(token: unknown): Promise<ShareLookup> {
  if (typeof token !== 'string' || !/^[0-9a-f]{20,80}$/.test(token)) return { state: 'missing' }
  const { rows } = await db.query<ShareRow>(
    'SELECT token, model_id, orthophoto_id, can_edit, allow_google3d, label, created_at, expires_at FROM share_links WHERE token = $1',
    [token],
  )
  const row = rows[0]
  if (!row) return { state: 'missing' }
  return { state: isExpired(row) ? 'expired' : 'ok', row }
}

/** True when `token` is a valid, unexpired share link for exactly this model. */
export async function shareGrantsModel(token: unknown, modelId: string): Promise<boolean> {
  const s = await findShare(token)
  return s.state === 'ok' && s.row.model_id === modelId
}

/** True when `token` is a valid, unexpired share link for exactly this orthophoto. */
export async function shareGrantsOrtho(token: unknown, orthoId: string): Promise<boolean> {
  const s = await findShare(token)
  return s.state === 'ok' && s.row.orthophoto_id === orthoId
}
