-- v0.8.0 S3 P9: add optional `description` to projects + visuals.
-- Locked at 1000 chars in the MCP tool layer; DB stays untyped TEXT NULL.

ALTER TABLE projects ADD COLUMN description TEXT;
ALTER TABLE visuals  ADD COLUMN description TEXT;

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '6');
