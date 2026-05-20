-- v0.8.0 S8 P1.A — visual references replace text examples.
-- R16 supersedes R13's text-examples section: drop legacy text-example data
-- from the `examples` JSON column on send_template_versions. The column keeps
-- its name (no rename) but holds a new shape from S8 onward:
--   [{name: 'ref1'|'ref2'|'ref3', visual_id: string, visual_version: number|null}]
--
-- Q1 lock (drop, don't migrate): the founder's pivot is replacement, not
-- coexistence. Text examples blew apart for visual code-gen (5KB HTML per
-- slot, cramped 2-row textarea). Users who had text examples re-create as
-- visual refs if those examples were load-bearing.
--
-- send_template_versions is the immutable history table; we clear its
-- examples cells too so retroactive reads through the LEFT JOIN in
-- SELECT_TEMPLATES surface NULL instead of orphaned input/output rows.
-- Builtins seeded by 005 + 011 already carry NULL examples — no-op there.

UPDATE send_template_versions SET examples = NULL WHERE examples IS NOT NULL;

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '12');
