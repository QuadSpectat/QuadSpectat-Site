/**
 * Thin pg-compatible shim backed by better-sqlite3 (SQLite).
 * Exposes the same `db.query(sql, params)` interface used throughout the routes
 * so no route code needs to change.
 *
 * Translates PostgreSQL-style $1/$2 placeholders → SQLite ? placeholders.
 * Translates `RETURNING *` → executes an extra SELECT after INSERT/UPDATE.
 * Translates `gen_random_uuid()` → handled by explicit UUID inserts in routes.
 * Translates `NOW()` → datetime('now').
 */
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { env } from './env'

const DB_PATH = process.env.DATA_DIR
  ? require('node:path').join(process.env.DATA_DIR, 'viewer.db')
  : path.join(process.cwd(), 'data', 'viewer.db')

// Ensure data dir exists
import { mkdirSync } from 'node:fs'
mkdirSync(path.dirname(DB_PATH), { recursive: true })

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

// ── Bootstrap schema ────────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS models (
    id           TEXT PRIMARY KEY,
    asset_name   TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    file_key     TEXT UNIQUE,
    file_size    INTEGER,
    file_type    TEXT,
    longitude    REAL NOT NULL DEFAULT 0,
    latitude     REAL NOT NULL DEFAULT 0,
    altitude     REAL NOT NULL DEFAULT 0,
    heading      REAL NOT NULL DEFAULT 0,
    pitch        REAL NOT NULL DEFAULT 0,
    roll         REAL NOT NULL DEFAULT 0,
    scale        REAL NOT NULL DEFAULT 1,
    model_type   TEXT NOT NULL DEFAULT 'gltf',
    external_url TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS share_links (
    token         TEXT PRIMARY KEY,
    model_id      TEXT REFERENCES models(id) ON DELETE CASCADE,
    orthophoto_id TEXT REFERENCES orthophotos(id) ON DELETE CASCADE,
    label         TEXT,
    can_edit      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((model_id IS NOT NULL) <> (orthophoto_id IS NOT NULL))
  );

  CREATE TABLE IF NOT EXISTS layers (
    id         TEXT PRIMARY KEY,
    model_id   TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    file_key   TEXT NOT NULL,
    file_type  TEXT NOT NULL DEFAULT 'kml',
    visible    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orthophotos (
    id              TEXT PRIMARY KEY,
    asset_name      TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    file_key        TEXT UNIQUE,
    cog_key         TEXT,
    original_format TEXT,
    bounds_west     REAL,
    bounds_south    REAL,
    bounds_east     REAL,
    bounds_north    REAL,
    zoom_min        INTEGER NOT NULL DEFAULT 0,
    zoom_max        INTEGER NOT NULL DEFAULT 22,
    visible         INTEGER NOT NULL DEFAULT 1,
    opacity         REAL NOT NULL DEFAULT 1.0,
    status          TEXT NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    show_watermark  INTEGER NOT NULL DEFAULT 1,
    watermark_text  TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// ── Migrations: add new columns if they don't exist ─────────────────────────
// SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we try/catch each one.
;[
  `ALTER TABLE models ADD COLUMN asset_name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE models ADD COLUMN coordinate_system TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE models ADD COLUMN geoid_offset REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE models ADD COLUMN show_watermark INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE models ADD COLUMN watermark_text TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE orthophotos ADD COLUMN asset_name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE orthophotos ADD COLUMN show_watermark INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE orthophotos ADD COLUMN watermark_text TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE share_links ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE share_links ADD COLUMN expires_at TEXT`,
].forEach((sql) => {
  try { sqlite.exec(sql) } catch { /* column already exists */ }
})

// share_links needs `model_id` to be nullable and an `orthophoto_id` column so
// orthophotos can be shared too. SQLite can't ALTER a NOT NULL constraint, so
// rebuild the table when the new column is missing. Idempotent via PRAGMA check.
{
  const cols = sqlite.prepare(`PRAGMA table_info(share_links)`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'orthophoto_id')) {
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE share_links_new (
          token         TEXT PRIMARY KEY,
          model_id      TEXT REFERENCES models(id) ON DELETE CASCADE,
          orthophoto_id TEXT REFERENCES orthophotos(id) ON DELETE CASCADE,
          label         TEXT,
          can_edit      INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK ((model_id IS NOT NULL) <> (orthophoto_id IS NOT NULL))
        );
        INSERT INTO share_links_new (token, model_id, orthophoto_id, label, can_edit, created_at)
          SELECT token, model_id, NULL, label, can_edit, created_at FROM share_links;
        DROP TABLE share_links;
        ALTER TABLE share_links_new RENAME TO share_links;
      `)
    })()
  }
}

// ── Client pages + link expiry (additive; safe to run on every start) ───────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS client_pages (
    token      TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT
  );
  CREATE TABLE IF NOT EXISTS client_page_assets (
    client_token TEXT NOT NULL REFERENCES client_pages(token) ON DELETE CASCADE,
    share_token  TEXT NOT NULL REFERENCES share_links(token) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (client_token, share_token)
  );
`)
// ── Saved camera views per model (additive; safe to run on every start) ─────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS saved_views (
    id         TEXT PRIMARY KEY,
    model_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    camera     TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_saved_views_model ON saved_views(model_id);
`)
// ── Layers: status, placement, persistence, client visibility (additive; safe to run on every start) ──
// Old rows get defaults that reproduce the previous behaviour: visible, offset 0, clamp_mode 'none' (file heights
// untouched), not shown to clients, status 'ready'. sort_order is backfilled from the upload order once.
{
  const layerCols = new Set((sqlite.prepare(`PRAGMA table_info(layers)`).all() as Array<{ name: string }>).map((c) => c.name))
  ;[
    ['opacity', `REAL NOT NULL DEFAULT 1`],
    ['height_offset', `REAL NOT NULL DEFAULT 0`],
    ['clamp_mode', `TEXT NOT NULL DEFAULT 'none'`],
    ['source_crs', `TEXT`],
    ['source_name', `TEXT`],
    ['status', `TEXT NOT NULL DEFAULT 'ready'`],
    ['status_message', `TEXT`],
    ['sort_order', `INTEGER NOT NULL DEFAULT 0`],
    ['client_visible', `INTEGER NOT NULL DEFAULT 0`],
    ['feature_count', `INTEGER`],
    ['byte_size', `INTEGER`],
    ['bbox', `TEXT`],
    ['has_z', `INTEGER NOT NULL DEFAULT 0`],
  ].forEach(([name, def]) => {
    if (!layerCols.has(name)) sqlite.exec(`ALTER TABLE layers ADD COLUMN ${name} ${def}`)
  })
  if (!layerCols.has('sort_order')) {
    sqlite.exec(`UPDATE layers SET sort_order = (
      SELECT COUNT(*) FROM layers l2 WHERE l2.model_id = layers.model_id
        AND (l2.created_at < layers.created_at OR (l2.created_at = layers.created_at AND l2.rowid < layers.rowid)))`)
  }
}
// ── Orthophotos: stacking order (additive; safe to run on every start) ──
// sort_order = position in the stack within an asset, higher = drawn on top. Backfilled once from the upload
// order (oldest 0, newest highest) so existing assets keep "newest on top", now stable across reloads.
{
  const orthoCols = new Set((sqlite.prepare(`PRAGMA table_info(orthophotos)`).all() as Array<{ name: string }>).map((c) => c.name))
  if (!orthoCols.has('sort_order')) {
    sqlite.transaction(() => {
      sqlite.exec(`ALTER TABLE orthophotos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
      sqlite.exec(`UPDATE orthophotos SET sort_order = (
        SELECT COUNT(*) FROM orthophotos o2 WHERE o2.asset_name = orthophotos.asset_name
          AND (o2.created_at < orthophotos.created_at OR (o2.created_at = orthophotos.created_at AND o2.rowid < orthophotos.rowid)))`)
    })()
  }
}
// ── Models: GLB height convention + explicit public-demo flag (additive; safe to run on every start) ──
// geoid_mode: 0 = legacy: the model is drawn exactly as before (3D Tiles shifted by geoid_offset, a GLB at its altitude), so no
//   existing model moves; 1 = orthometric: the heights of the model are heights above sea level and it is drawn at h = H + N
//   (N = EGM2008 geoid height at the model, about +17 to +22.5 m in Israel). Only new uploads (ITM choice) and an explicit owner
//   tick in Edit model set it.
// is_public_demo: replaces "asset name contains DEMO" as the rule for what anonymous visitors may list and open. The columns
//   are added once, and in that same transaction every existing model / orthophoto whose asset name contains the old marker
//   (PUBLIC_ASSET_NAME, default DEMO) is flagged, so the public demo keeps working. Later starts never re-flag anything.
{
  const cols = (t: string) => new Set((sqlite.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name))
  const m = cols('models')
  const o = cols('orthophotos')
  sqlite.transaction(() => {
    if (!m.has('geoid_mode')) sqlite.exec(`ALTER TABLE models ADD COLUMN geoid_mode INTEGER NOT NULL DEFAULT 0`)
    // google_offset: metres added to the model's height ONLY while Google 3D is shown (owner's "Align to Google 3D"); 0 = no change
    if (!m.has('google_offset')) sqlite.exec(`ALTER TABLE models ADD COLUMN google_offset REAL NOT NULL DEFAULT 0`)
    const marker = env.PUBLIC_ASSET_NAME.trim()
    if (!m.has('is_public_demo')) {
      sqlite.exec(`ALTER TABLE models ADD COLUMN is_public_demo INTEGER NOT NULL DEFAULT 0`)
      if (marker) sqlite.prepare(`UPDATE models SET is_public_demo = 1 WHERE LOWER(asset_name) LIKE '%' || LOWER(?) || '%'`).run(marker)
    }
    // allow_google3d: per client (share link / client page) switch for Google Photorealistic 3D; off for everyone by default
    const cols2 = (t: string) => new Set((sqlite.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name))
    if (!cols2('share_links').has('allow_google3d')) sqlite.exec(`ALTER TABLE share_links ADD COLUMN allow_google3d INTEGER NOT NULL DEFAULT 0`)
    if (!cols2('client_pages').has('allow_google3d')) sqlite.exec(`ALTER TABLE client_pages ADD COLUMN allow_google3d INTEGER NOT NULL DEFAULT 0`)
    if (!o.has('is_public_demo')) {
      sqlite.exec(`ALTER TABLE orthophotos ADD COLUMN is_public_demo INTEGER NOT NULL DEFAULT 0`)
      if (marker) sqlite.prepare(`UPDATE orthophotos SET is_public_demo = 1 WHERE LOWER(asset_name) LIKE '%' || LOWER(?) || '%'`).run(marker)
    }
  })()
}
// Links created before expiry existed become valid until one year after they were created.
sqlite.exec(`UPDATE share_links SET expires_at = strftime('%Y-%m-%dT%H:%M:%SZ', created_at, '+365 days') WHERE expires_at IS NULL`)
sqlite.exec(`UPDATE client_pages SET expires_at = strftime('%Y-%m-%dT%H:%M:%SZ', created_at, '+365 days') WHERE expires_at IS NULL`)

// ── Query helper ─────────────────────────────────────────────────────────────
function pgToSqlite(sql: string): string {
  // Replace $1, $2, … with ?
  return sql
    .replace(/\$\d+/g, '?')
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/COALESCE\(([^,]+),\s*([^)]+)\)/gi, 'COALESCE($1, $2)')
}

interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number
}

function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return new Promise((resolve, reject) => {
    try {
      const converted = pgToSqlite(sql)
      const args = params ?? []

      const upper = sql.trimStart().toUpperCase()

      if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
        const stmt = sqlite.prepare(converted)
        const rows = stmt.all(...args) as T[]
        resolve({ rows, rowCount: rows.length })
        return
      }

      // For INSERT/UPDATE/DELETE with RETURNING — strip RETURNING, run write, then SELECT
      const returningMatch = /\s+RETURNING\s+\*/i.exec(converted)
      if (returningMatch) {
        const writeSQL = converted.slice(0, returningMatch.index)
        const stmt = sqlite.prepare(writeSQL)

        // Detect table name — handles INSERT INTO, UPDATE, and DELETE FROM
        const tableMatch = /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i.exec(writeSQL)
        const table = tableMatch?.[1] ?? ''

        if (upper.startsWith('INSERT')) {
          // We need the id — either it's in params (explicit UUID) or last insert rowid
          stmt.run(...args)
          const lastId = (sqlite.prepare(`SELECT last_insert_rowid() as rowid`).get() as { rowid: number }).rowid
          // Try to find the row by rowid (SQLite internal rowid works even for TEXT PK)
          const row = sqlite.prepare(`SELECT * FROM ${table} WHERE rowid = ?`).get(lastId) as T
          resolve({ rows: row ? [row] : [], rowCount: 1 })
        } else if (upper.startsWith('DELETE')) {
          // For DELETE: snapshot the row BEFORE deleting — it won't exist after
          const idParam = args[args.length - 1]
          const row = sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(idParam) as T | undefined
          stmt.run(...args)
          resolve({ rows: row ? [row] : [], rowCount: row ? 1 : 0 })
        } else {
          // UPDATE — run then fetch with WHERE id = last param
          stmt.run(...args)
          const idParam = args[args.length - 1]
          const row = sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(idParam) as T | undefined
          resolve({ rows: row ? [row] : [], rowCount: row ? 1 : 0 })
        }
        return
      }

      // Plain write (DELETE etc.)
      const stmt = sqlite.prepare(converted)
      const info = stmt.run(...args)
      resolve({ rows: [], rowCount: info.changes })
    } catch (err) {
      reject(err)
    }
  })
}

export const db = { query }
export { randomUUID }

