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
    token      TEXT PRIMARY KEY,
    model_id   TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    label      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// ── Migrations: add new columns if they don't exist ─────────────────────────
// SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we try/catch each one.
;[
  `ALTER TABLE models ADD COLUMN coordinate_system TEXT NOT NULL DEFAULT 'unknown'`,
  `ALTER TABLE models ADD COLUMN geoid_offset REAL NOT NULL DEFAULT 0`,
].forEach((sql) => {
  try { sqlite.exec(sql) } catch { /* column already exists */ }
})

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

