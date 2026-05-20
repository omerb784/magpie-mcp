-- v0.8.0 S7 P1.A — seed 5 remaining builtins as short-form send_templates.
-- These are the dashboard-palette counterparts to the 5 MCP prompts shipped
-- in S5 P4 (a11y_audit / responsive_check / dark_mode_port / simplify /
-- add_data). The MCP prompts keep their XML-wrapped <instructions> bodies
-- per R12 — the slash-menu surface is canonical for that primitive.
-- These rows give the same verbs a short flat body that the workbench can
-- ⌘K-pick and interpolate against the active visual.
--
-- Each row carries one user variable matching the MCP prompt's main arg
-- (target_level / breakpoints / dimension / data_description) so the
-- workbench inputs pane renders something meaningful. dark_mode_port has
-- no extra arg; its row keeps just the system vars.
--
-- Stable ids let re-runs hit the IGNORE branch (matches the 005 seed style).

INSERT OR IGNORE INTO send_templates
  (id, name, body, var_names, is_builtin, sort_order, created_at, current_version_num)
VALUES
  ('builtin-a11y-audit',
   'A11y audit',
   'Audit visual {{id}} ({{title}}, v{{ver}}) against WCAG {{target_level}}. Cite each failing criterion and return concrete code patches.',
   '["target_level"]',
   1, 4, '2026-05-13T00:00:00.000Z', 1),
  ('builtin-responsive-check',
   'Responsive check',
   'Check visual {{id}} ({{title}}, v{{ver}}) at breakpoints {{breakpoints}}. Flag layout/legibility/touch-target issues per breakpoint and return CSS patches.',
   '["breakpoints"]',
   1, 5, '2026-05-13T00:00:00.000Z', 1),
  ('builtin-dark-mode-port',
   'Dark-mode port',
   'Port visual {{id}} ({{title}}, v{{ver}}) to dark mode. Preserve WCAG AA contrast — do not naive-invert. Recalibrate accent colors as needed.',
   '[]',
   1, 6, '2026-05-13T00:00:00.000Z', 1),
  ('builtin-simplify',
   'Simplify',
   'Simplify visual {{id}} ({{title}}, v{{ver}}) along the {{dimension}} dimension. Cut what is not load-bearing; keep the brief intact.',
   '["dimension"]',
   1, 7, '2026-05-13T00:00:00.000Z', 1),
  ('builtin-add-data',
   'Add realistic data',
   'Extend visual {{id}} ({{title}}, v{{ver}}) with realistic data: {{data_description}}. Keep the existing structure — swap placeholder text/numbers for plausible domain values.',
   '["data_description"]',
   1, 8, '2026-05-13T00:00:00.000Z', 1);

-- Backfill v1 rows in send_template_versions for the 5 new builtins so
-- the LEFT-JOIN in SELECT_TEMPLATES never returns NULL examples for them.
-- (Migration 009 ran the equivalent backfill for pre-009 templates.)
INSERT OR IGNORE INTO send_template_versions
  (id, template_id, version_num, body, var_schema, examples, created_at)
SELECT id || '-v1', id, 1, body, NULL, NULL, created_at
  FROM send_templates
 WHERE id IN (
   'builtin-a11y-audit',
   'builtin-responsive-check',
   'builtin-dark-mode-port',
   'builtin-simplify',
   'builtin-add-data'
 );

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '11');
