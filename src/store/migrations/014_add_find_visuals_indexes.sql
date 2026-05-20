-- v0.9.2 Phase D / D3 - index coverage for find_visuals hot path.
--
-- Audit at 1K visuals (seed-bench fixture) found two SCAN v plans on shapes
-- the runner can fix with single-column indexes:
--   * WHERE v.type = ?       -> SCAN v  -> SEARCH v USING INDEX idx_visuals_type
--   * ORDER BY v.updated_at  -> TEMP B-TREE -> uses idx_visuals_updated_at
--
-- Remaining SCAN v cases are documented findings (not fixable here):
--   * v.title LIKE '%foo%'  -- leading wildcard, FTS5 deferred to post-v1.0
--   * tag-EXISTS subquery   -- correlated; query rewrite breaks tags-AND semantics
--
-- Forward-only per R21. Pure index adds. No FK touch. FK-ON throughout.

CREATE INDEX IF NOT EXISTS idx_visuals_type ON visuals(type);
CREATE INDEX IF NOT EXISTS idx_visuals_updated_at ON visuals(updated_at);

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '14');
