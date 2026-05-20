-- Seed canonical demo tag colors. Append-only: never overwrite a color the user
-- already chose. Tags are inserted with a stable id based on the name so future
-- runs hit the ON CONFLICT branch.

INSERT INTO tags (id, name, color)
VALUES
  ('seed_tag_dashboard', 'dashboard',  '#d97757'),
  ('seed_tag_darkmode',  'dark-mode',  '#6a9bcc'),
  ('seed_tag_minimal',   'minimal',    '#788c5d'),
  ('seed_tag_wip',       'wip',        '#a89455'),
  ('seed_tag_diagram',   'diagram',    '#9c7bb8'),
  ('seed_tag_icon',      'icon',       '#c08fa3')
ON CONFLICT(name) DO UPDATE
  SET color = excluded.color
  WHERE tags.color IS NULL;

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '2');
