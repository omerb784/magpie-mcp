-- v0.8.0 S4 P1.A: agent_inbox table for the push-inbox pillar.
-- User composes prompt in dashboard, persists here; LLM picks up via read_inbox tool.
-- consumed_at NULL = pending; ISO 8601 = consumed (Kanban warm-handoff pattern).

CREATE TABLE agent_inbox (
  id           TEXT PRIMARY KEY,
  visual_id    TEXT,
  template_id  TEXT,
  prompt_body  TEXT NOT NULL,
  vars         TEXT,
  created_at   TEXT NOT NULL,
  consumed_at  TEXT,
  FOREIGN KEY (visual_id)   REFERENCES visuals(id)        ON DELETE SET NULL,
  FOREIGN KEY (template_id) REFERENCES send_templates(id) ON DELETE SET NULL
);

CREATE INDEX idx_inbox_status ON agent_inbox(consumed_at);
CREATE INDEX idx_inbox_visual ON agent_inbox(visual_id);

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '7');
