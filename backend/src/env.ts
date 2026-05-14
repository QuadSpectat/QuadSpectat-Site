import 'dotenv/config'

function require(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required env var: ${key}`)
  return value
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback
}

export const env = {
  PORT: optional('PORT', '3001'),
  DATABASE_URL: optional('DATABASE_URL'),          // unused when SQLite is active
  SPACES_KEY: optional('SPACES_KEY'),
  SPACES_SECRET: optional('SPACES_SECRET'),
  SPACES_BUCKET: optional('SPACES_BUCKET', 'quadspectat-models'),
  SPACES_REGION: optional('SPACES_REGION', 'fra1'),
  SPACES_ENDPOINT: optional('SPACES_ENDPOINT', 'https://fra1.digitaloceanspaces.com'),
  PRESIGN_EXPIRY_SECONDS: Number(optional('PRESIGN_EXPIRY_SECONDS', '3600')),
} as const
