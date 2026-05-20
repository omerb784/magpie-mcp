-- v0.8.0 S7 P2.A — optional scope on send_templates.
-- Both columns NULL = global (existing rows; builtins always stay global).
-- Exactly one set = scoped (XOR enforced by the store layer at insert/update).
-- Hard-delete on the referenced project / visual cascades to scoped templates.
-- Archive does not cascade (no FK reference to archived_at).

ALTER TABLE send_templates ADD COLUMN scope_project_id TEXT
  REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE send_templates ADD COLUMN scope_visual_id TEXT
  REFERENCES visuals(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_send_templates_scope
  ON send_templates(scope_project_id, scope_visual_id, sort_order);

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '10');
