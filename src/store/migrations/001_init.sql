PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  type         TEXT NOT NULL CHECK (type IN ('mockup','diagram','mixed')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT
);

CREATE TABLE IF NOT EXISTS visuals (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('html','mermaid','svg')),
  source       TEXT,
  current_ver  INTEGER NOT NULL DEFAULT 1,
  starred      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  archived_at  TEXT
);

CREATE TABLE IF NOT EXISTS versions (
  id            TEXT PRIMARY KEY,
  visual_id     TEXT NOT NULL REFERENCES visuals(id) ON DELETE CASCADE,
  version_num   INTEGER NOT NULL,
  content_path  TEXT NOT NULL,
  thumb_path    TEXT,
  render_status TEXT NOT NULL DEFAULT 'pending' CHECK (render_status IN ('pending','ok','warn','failed')),
  render_error  TEXT,
  message       TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (visual_id, version_num)
);

CREATE TABLE IF NOT EXISTS tags (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  color  TEXT
);

CREATE TABLE IF NOT EXISTS visual_tags (
  visual_id TEXT NOT NULL REFERENCES visuals(id) ON DELETE CASCADE,
  tag_id    TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (visual_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_visuals_project ON visuals(project_id);
CREATE INDEX IF NOT EXISTS idx_visuals_starred ON visuals(starred) WHERE starred = 1;
CREATE INDEX IF NOT EXISTS idx_visuals_source  ON visuals(source);
CREATE INDEX IF NOT EXISTS idx_versions_visual ON versions(visual_id);

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '1');
