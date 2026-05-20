-- v0.6.0 S2 Phase E: Send-to-Claude templates table.
-- Stores 3 built-in templates (Iterate / Variants / Explain) seeded below,
-- plus user-created templates with up to 5 mustache-style {{vars}}.

CREATE TABLE IF NOT EXISTS send_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  body        TEXT NOT NULL,
  var_names   TEXT NOT NULL,
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_send_templates_builtin
  ON send_templates(is_builtin, sort_order);

-- Idempotent seed: stable ids let re-runs hit the IGNORE branch.
INSERT OR IGNORE INTO send_templates (id, name, body, var_names, is_builtin, sort_order, created_at)
VALUES
  ('builtin-iterate',  'Iterate',  'Iterate visual {{id}} ({{title}}, currently v{{ver}}) — make it {{change}}.', '["change"]', 1, 1, '2026-05-09T00:00:00.000Z'),
  ('builtin-variants', 'Variants', 'Generate {{count}} variants of visual {{id}} ({{title}}, currently v{{ver}}).',  '["count"]',  1, 2, '2026-05-09T00:00:00.000Z'),
  ('builtin-explain',  'Explain',  'Explain what visual {{id}} ({{title}}) is showing and how it''s structured.',     '[]',         1, 3, '2026-05-09T00:00:00.000Z');

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '5');
