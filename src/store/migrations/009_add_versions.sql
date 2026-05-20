-- v0.8.0 S5 P3.A — immutable template versioning + audit pointer.
-- Q5 lock: applies to user-authored send_templates (not MCP prompts —
-- those version via git). Q7=A: diff toggle ships in S5 from this table.

-- New table: every save of a send_template appends an immutable row here.
-- The `send_templates.current_version_num` pointer (added below) names
-- which version is the "current" one. Older versions stay readable.
CREATE TABLE send_template_versions (
  id            TEXT PRIMARY KEY,
  template_id   TEXT NOT NULL,
  version_num   INTEGER NOT NULL,
  body          TEXT NOT NULL,
  var_schema    TEXT,
  examples      TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES send_templates(id) ON DELETE CASCADE,
  UNIQUE (template_id, version_num)
);

CREATE INDEX idx_template_versions_template
  ON send_template_versions(template_id, version_num);

-- Pointer to the active version per template. Always exists (NOT NULL).
ALTER TABLE send_templates ADD COLUMN current_version_num INTEGER NOT NULL DEFAULT 1;

-- Audit trail on the inbox — captured at send time, frozen forever.
-- Nullable for legacy entries that pre-date this migration.
ALTER TABLE agent_inbox ADD COLUMN template_version_num INTEGER;

-- Backfill every existing send_templates row as v1 in the versions
-- table. Synthetic id format `<template_id>-v1` is reproducible and
-- avoids needing application-level newId() at migration time.
INSERT INTO send_template_versions (id, template_id, version_num, body, var_schema, examples, created_at)
SELECT id || '-v1', id, 1, body, var_schema, NULL, created_at FROM send_templates;

-- Pointer for existing rows already defaults to 1, so no UPDATE needed.

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '9');
