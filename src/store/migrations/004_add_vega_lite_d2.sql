-- v0.3.0 S1: widen visuals.type CHECK to include vega-lite + d2.
-- SQLite cannot ALTER a CHECK constraint, so rebuild the table (same shape as 003).

PRAGMA foreign_keys = OFF;

CREATE TABLE visuals_new (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('html','mermaid','svg','markdown','dot','vega-lite','d2')),
  source       TEXT,
  current_ver  INTEGER NOT NULL DEFAULT 1,
  starred      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT
);

INSERT INTO visuals_new
  (id, project_id, title, type, source, current_ver, starred, created_at, updated_at, archived_at)
SELECT
  id, project_id, title, type, source, current_ver, starred, created_at, updated_at, archived_at
FROM visuals;

DROP TABLE visuals;
ALTER TABLE visuals_new RENAME TO visuals;

CREATE INDEX IF NOT EXISTS idx_visuals_project ON visuals(project_id);
CREATE INDEX IF NOT EXISTS idx_visuals_starred ON visuals(starred) WHERE starred = 1;
CREATE INDEX IF NOT EXISTS idx_visuals_source  ON visuals(source);

PRAGMA foreign_keys = ON;

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '4');
