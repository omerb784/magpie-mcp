-- v0.8.0 S5 P1.A: add optional typed-variable schema to send_templates.
-- JSON array of {name, type, required?, default?, label?, options?} per Q1 lock.
-- Null = legacy mustache template (back-compat preserved).
-- type ∈ "string" | "multiline" | "enum". Enums require options:string[].

ALTER TABLE send_templates ADD COLUMN var_schema TEXT;

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '8');
