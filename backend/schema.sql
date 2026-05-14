-- PostgreSQL 13+ has gen_random_uuid() built-in; this extension adds it for older versions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------
-- models
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS models (
  id          UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT             NOT NULL,
  description TEXT,
  -- S3/Spaces object key, e.g. "models/550e8400-e29b-41d4-a716-446655440000.glb"
  file_key    TEXT             NOT NULL UNIQUE,
  file_size   BIGINT,                          -- bytes
  file_type   TEXT,                            -- MIME type, e.g. "model/gltf-binary"
  -- Globe position and orientation
  longitude   DOUBLE PRECISION NOT NULL DEFAULT 0,   -- degrees
  latitude    DOUBLE PRECISION NOT NULL DEFAULT 0,   -- degrees
  altitude    DOUBLE PRECISION NOT NULL DEFAULT 0,   -- metres above ellipsoid
  heading     DOUBLE PRECISION NOT NULL DEFAULT 0,   -- degrees, 0 = north
  pitch       DOUBLE PRECISION NOT NULL DEFAULT 0,   -- degrees
  roll        DOUBLE PRECISION NOT NULL DEFAULT 0,   -- degrees
  scale       DOUBLE PRECISION NOT NULL DEFAULT 1,
  -- Model type: 'gltf' | '3d-tiles' | 'pointcloud'
  model_type  TEXT             NOT NULL DEFAULT 'gltf',
  -- For 3D Tiles: the tileset URL (external or Spaces-hosted)
  external_url TEXT,
  created_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS models_created_at_idx ON models (created_at DESC);

-- -----------------------------------------------------------------------
-- auto-update updated_at on every row change
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS models_set_updated_at ON models;
CREATE TRIGGER models_set_updated_at
  BEFORE UPDATE ON models
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
