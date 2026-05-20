-- v0.9.2 Phase A — per-version `description` column on versions.
-- Lock 2026-05-14: `iterate(message=…)` is capped at 500 chars and rejects
-- longer notes. Visual-level `description` (set via update_visual or add_visual)
-- is per-VISUAL, not per-VERSION. Gap discovered during status-board v3→v4
-- iterate where the change-log needed ~700 chars.
--
-- Decision (memory project_v092_hopper_per_version_description.md):
--   - set-once at iterate (no retro edit at v0.9.2)
--   - cap matches visual.description (1000 chars, enforced upstream)
--   - dashboard surfaces as chevron-expand row in version history (read-only)
--
-- Forward-only. NULL default keeps every existing row backward-safe.

ALTER TABLE versions ADD COLUMN description TEXT;

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '13');
