// v0.9.2 / Phase C / M7 — aggressive trim per Owner decision iii.
// Pre-trim INSTRUCTIONS shipped a ~6.6 KB body (v10 layered-fallback shape:
// skill-defer line prepended in front of the full v0.9.0 narrative). The
// shipping cost is per-conversation-turn (token-cost audit M4), so the
// fallback now keeps only the skill-defer line plus a minimal 6-line
// substrate the LLM can recover from when the skill isn't loaded. The
// magpie-master skill (shipped in v0.9.1, R20) carries the long-form
// decision flow and worked-examples; this string is the offline floor,
// not the full reference. INSTRUCTIONS_VERSION 10 → 11.
export const INSTRUCTIONS = `If the magpie-master skill is loaded, defer to it for all decisions below. Otherwise apply the rules here.

Magpie lands every visual you author into a nest you can browse. It does not generate — you do, or another generator MCP does.
Tools: add_visual(project, type, content|content_path) to save · iterate(visual_id, content) to refine (always full body, never a diff) · list_projects · find_visuals · list_versions · open_preview · compare · update_visual · update_project · archive_visual · archive_project · merge_projects · read_inbox.
Resources: magpie://library · magpie://project/{name} · magpie://visual/{id}[/v{n}] · magpie://inbox.
Prompts (slash menu): iterate · variants · explain · a11y_audit · responsive_check · dark_mode_port · simplify · add_data.
Types: html · mermaid · svg · markdown · dot · vega-lite · d2.
Rules: never invent visual_id (use one from a prior tool result or find_visuals) · prefer content_path over inline content for anything >~a few KB · URLs are not valid content; only absolute file paths under the project root · markdown fences are stripped except for type='markdown' · delete/purge is UI-only — return the dashboard URL instead.`;
