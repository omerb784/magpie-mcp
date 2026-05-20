-- v0.9.3 Phase E / T5 - seed 2 wedge builtins reflecting R23 scope broadening.
-- R23 (2026-05-16) lifts Magpie's scope from "mockups + diagrams" to every
-- non-code thing your AI produces - status reports, ADRs, decision logs,
-- prose, plans, references. The first 8 builtins (S5 + S7 seeds) all assume
-- HTML/visual output; these two cover the markdown/text wedge so the
-- workbench palette matches the broadened verb surface.
--
-- Polish prose       - tighten copy/voice on a markdown deliverable.
-- Extract decisions  - distill a status report or walkthrough into a
--                      structured list of decisions made / open / blocked.
--
-- Pattern matches 011 (INSERT OR IGNORE + sort_order continuation +
-- v1 backfill in send_template_versions).

INSERT OR IGNORE INTO send_templates
  (id, name, body, var_names, is_builtin, sort_order, created_at, current_version_num)
VALUES
  ('builtin-polish-prose',
   'Polish prose',
   'Polish the prose in visual {{id}} ({{title}}, v{{ver}}) to a {{tone}} tone. Keep the structure intact; cut hedging, tighten verbs, preserve technical claims verbatim.',
   '["tone"]',
   1, 9, '2026-05-17T00:00:00.000Z', 1),
  ('builtin-extract-decisions',
   'Extract decisions',
   'Read visual {{id}} ({{title}}, v{{ver}}) and extract the decisions it contains as {{output_shape}}. Include: decision text, status (locked/open/superseded), the why-line if present, and any blocker. Drop discussion that did not result in a decision.',
   '["output_shape"]',
   1, 10, '2026-05-17T00:00:00.000Z', 1);

INSERT OR IGNORE INTO send_template_versions
  (id, template_id, version_num, body, var_schema, examples, created_at)
SELECT id || '-v1', id, 1, body, NULL, NULL, created_at
  FROM send_templates
 WHERE id IN ('builtin-polish-prose', 'builtin-extract-decisions');

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '15');
