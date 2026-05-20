# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on 0.5 → 0.9.3 gap.** Versions between `0.4.0-pre` and `1.0.0` were tagged locally during development but never published to npm (per the v0.2.0 Owner decision to defer all npm publishes until v1.0). Per-release detail lives in `docs/v0.N.0/status.md` for each tag (e.g. `docs/v0.9.3/status.md`). The `1.0.0` entry below rolls up everything material that changed since `v0.4.0-pre`. From v1.0 onward, every published release gets its own entry here.

## [1.0.0] — 2026-05-20 — first public release · soft launch

First time on npm. First time GitHub-public. Soft-launch shape — `npx magpie-mcp` quietly live; all marketing surfaces (HN/PH/Reddit/Twitter/LinkedIn/Dev.to/directory drops · demo video) deferred to v1.0.1+ public-launch sprint.

### Theme

The polished v0.9.3 binary becomes a published artifact. Path 1 ship-minimum strategy — every KEEP item ships at v1 floor; v1.0.1 polish-pack follows within the week.

### Added since `0.4.0-pre` (rolled-up summary across 0.5 → 0.9.3 local tags)

**Brand + product (v0.7.0):**
- Brand rename Looksee → Magpie (R9). Storage relocated `~/.looksee/` → `~/.magpie/` with auto-migration. Wire-format break on Resources URI scheme (`looksee://` → `magpie://`). Single legacy `LOOKSEE_*` env-var shim dropped at v0.9.2 — `MAGPIE_*` is the only prefix recognized today.
- LOGO-A asset set + favicon chain + masthead mark + GitHub social preview + OG image.

**Visual formats (v0.2.0 → v0.3.0):**
- Markdown renderer (`marked` + DOMPurify → sanitized HTML).
- Graphviz/DOT renderer (`@hpcc-js/wasm-graphviz`).
- Vega-Lite charts (`vega-lite` + `vega` → SVG; inline `data.values` only, remote `data.url` rejected).
- D2 diagrams (`@terrastruct/d2` WASM).
- Format surface now 7 types: `html` · `mermaid` · `svg` · `markdown` · `dot` · `vega-lite` · `d2` (R7 locked).

**MCP surface (v0.2.0 + v0.8.0):**
- `content_path` arg on `add_visual` + `iterate` — pass an absolute path under the project root; bytes are read + copied. Avoids token-cost of inline content for large bodies.
- Tool count grew from 13 (v0.4.0) to 14 (v1.0): `read_inbox` added for warm session handoff across hosts. `rename_project` renamed to `update_project` (broader arg surface).

**Dashboard (v0.4.0 → v0.8.0):**
- Per-visual download (Source / Thumbnail PNG / Rendered SVG) + per-project zip export.
- Keyboard shortcuts (`/`, `Cmd+K`, `Esc`, `j/k`, `Enter`, `s`).
- Unified preview/compare shell with picker + sync-scroll via postMessage.
- "Talk with agent" redesign + archive undo + in-app confirm modal + `?` shortcuts overlay.
- VE workbench + template library + visual references.

**Architecture (v0.9.0):**
- R19 multi-host lifecycle — one canonical Magpie per machine, N facades. First process binds the IPC pipe at `$MAGPIE_HOME/magpie.pipe-*` and owns HTTP + SQLite + blob writes + render queue. Subsequent processes detect the pipe is bound and become facades. When canonical dies, exactly one facade wins the race to bind + becomes the new canonical (and re-binds the previous HTTP port so the dashboard URL doesn't change).
- Tool handlers run canonical-side. Per-facade cwd reaches the handler via the `hello` IPC handshake (`originCwd` in tool context).

**Skills (v0.9.1):**
- R20 master-as-skill — `magpie-master/SKILL.md` bundled in npm tarball. `npx magpie-mcp --install-skill` (5-outcome idempotent: same-hash no-op · older upgraded · same-version-edited refuses with diff hint · `--force` overrides). Skill defers to existing instructions for everything else.
- Layered fallback — MCP `instructions` string carries the same protocol shape so hosts without the skill loaded keep working.

**Security posture (v0.9.2):**
- 9-phase prod-readiness audit (59 probes / 8 dimensions / 0 findings open at close). 4 blockers fixed inline: IPC socket ACL · Chrome sandbox flags · HTTP DNS-rebind origin-guard · mermaid origin-guard carve-out.
- Strict iframe sandbox + uniform CSP per preview type.
- Forward-only migrations (R21) — no `.down.sql`, runner refuses downgrades.
- Prose-only errors for semantic failures (`textResult(msg, true)`); `McpError` reserved for protocol-level (F4 structured error code enum rejected per Owner decision i).

**Polish (v0.9.3):**
- R23 tagline lock — "Your loyal Magpie. Lands every visual in the nest." Verb "draws" → "lands" cascaded across 7 surfaces.
- Puppeteer render-pool zombie matcher + stale-lock cleanup.
- Track B E2E harness — 7 specs / 28 sub-cases including TWA round-trip.
- `magpie-mcp --backup <target>` CLI — WAL checkpoint + atomic tar (USTAR + gzip), zero new dependencies.
- 4 `npm audit fix` dep bumps.

### Added in v1.0 (new since v0.9.3)

- **Public site** at `github.io/magpie-mcp` — single-page static `site/index.html`. Hero with R23 tagline · 7-format text gallery · install snippet · 3 dashboard screenshots · cobalt-stone palette matching shipped UI (`ui/src/index.css`). No build step.
- **User guide bundled** at `seed/user-guide/` and served at `GET /guide` (static HTML + assets via `src/http/routes/guide.ts`). 16 screenshots (v0.6.0 chrome with "updating" banner — v1.0-chrome re-capture queued for v1.0.1). Rebrand strings sweep complete; zero looksee tokens remain.
- **Seed-import flow** — dashboard empty-state CTA with two buttons: primary "Ask Claude to create your first visual" (links to install snippet) · secondary "Load example project" → `POST /api/seed/load-example` writes the bundled `seed/example-bundle.json` (5 visuals · one per format) into MAGPIE_HOME as the `user-guide` project. Idempotent (refuse-if-exists with `{existing: true, projectId}` response). MCP tool surface unchanged at 14 (per Owner constraint — seed is dashboard HTTP only).
- **`magpie-master` skill v2** — added "v1.0 deltas" section with four sub-sections: seed CTA awareness (don't duplicate-seed, `user-guide` is a reserved project name) · R19 multi-host context (CANONICAL_RESTART retry, shared library across hosts) · R23 tagline language lock (verb "lands" only) · seed-vs-add disambiguation.
- **`magpie-security` skill** (Owner-local, never bundled) — 3008-word SKILL.md authoring the R24 pre-release review protocol against a frozen 15-invariant watch-list (Chrome flags · render profile isolation · IPC ACL · HTTP origin-guard · WS verifyClient · iframe sandbox + CSP · mermaid carve-out · tarball file allowlist · GHA SHA-pin · SBOM + Dependabot + audit · path redaction · `content_path` path-guard · forward-only migrations · prose-only errors · no-LLM no-remote-fetch server rule). Verdict protocol: green (no findings) / yellow (only MED+LO, advisory) / red (HI findings → blocks tag, per Q10 a). Owner installs via manual `cp` to `~/.claude/skills/`.
- **CLAUDE.md hard-rule** (Q11 a): "Magpie NEVER moves, edits, or deletes Owner source files; `content_path` = read + copy only." Applies across all tool handlers, render pipeline, export routes, and any future ingest path.
- **README**: npm + CI badges · tool count corrected to 14 (was stale at 13) · `--backup` CLI documented as shipped (was "future v0.9.3+") · new "Where files live" 4-line layered filesystem contract · changelog link at footer.
- **5-surface version bump script** (`scripts/bump-version.mjs`) — single command bumps `package.json` + `src/config.ts` VERSION + master + steward SKILL frontmatters + `src/cli/install-skill.ts` banner to a target version. Idempotent · dirty-guard · `--dry-run` · post-write self-verify · 9-case test suite.
- **Phase L close-ritual pre-writes** under `docs/v1.0/`: status.md (sprint state) · log.md (commit-by-commit) · close-ritual.md (exact T-0 + post-publish steps) · v1.0.1-hopper.md (40+ deferred items across 10 categories).

### Fixed

- **CRITICAL · pre-existing npm tarball leak.** `package.json#files` had a bare `"skill"` entry (introduced at v0.9.1 R20) which was silently shipping the entire `skill/magpie-steward/` directory (8 files / ~85KB · Owner-local dev tool content) to npm. Tightened to `"skill/magpie-master"`; only the master skill ships in the published tarball. Discovered + fixed during Session D's `magpie-security` skill build. Validated via `npm pack --dry-run`: zero `skill/magpie-steward/*` or `skill/magpie-security/*` entries in tarball; `node scripts/check-tarball.mjs` returns `status: OK · no disallowed paths`.
- **`src/skill/pack-includes-skill.test.ts`** updated to assert `"skill/magpie-master"` (the v1.0 boundary lock) instead of stale `"skill"` (the leaky form). Adds negative assertions: tarball must NOT contain bare `"skill"`, `"skill/magpie-steward"`, or `"skill/magpie-security"`.

### Changed

- **`package.json#files`** allowlist: `["dist", "skill/magpie-master", "seed", "scripts/preinstall-check.mjs", "README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md"]`. Was: bare `"skill"` (leaky) + no `"seed"` entry.
- **Site palette** — `site/index.html` repaletted from warm folk-art (paper `#faf6ef` + moss/terra/gold) to cobalt-stone (paper `#eef0f4` + cobalt `#1f2b80` + clay + shiny gold), matching the shipped dashboard tokens in `ui/src/index.css`. Hex-only swap inside `:root` and shadow rgba; the 23 `var(--…)` references throughout the page cascade automatically. Var names preserved (`--moss` now produces cobalt) to minimize diff per ship-minimum quality bar; v1.0.1 brand-redesign sprint can rename for semantic clarity.

### Security

- R24 (proposed) — `magpie-security` skill enforces the 15-invariant watch-list against the diff since the previous tag. HI findings block release; MED + LO advisory. First run on the v1.0 diff is an Owner mission gated on cp-install. R24 promotion to root `docs/decisions.md` deferred to v1.0.1 (rule lives in CLAUDE.md hard rules until enforcement has real first-run history).
- Filesystem origin-untouched contract — explicit CLAUDE.md hard rule (Q11 a). Applies to all current and future ingest paths.
- Tarball boundary lock — only `skill/magpie-master/SKILL.md` ships under `skill/`. `skill/magpie-steward/` and `skill/magpie-security/` are Owner-local dev tools that live in the repo for source-of-truth + version control but are excluded from the npm allowlist by `files` glob + tested.

### Deferred to v1.0.1+ (full list in `docs/v1.0/v1.0.1-hopper.md`)

Marketing surfaces (HN · PH · Reddit · Twitter · LinkedIn · Dev.to · 5 directory blurbs · FAQ · objection bank) · demo video (Loom 3-min + scripted 60-90s) · Phase M master skill v2 stages M1/M2/M4/M5 (eval-driven rewrite — M3 feature-bake shipped at v1.0) · seed scaffold polish (preview modal · backup-before-seed · format showcase · post-load tour overlay) · site polish (var-name rename · /guide mirror page on site · "How it works" 3-step animation · screenshot carousel · dark-mode toggle) · user guide v1.0-chrome screenshot re-capture · Cursor + Cline `--install-skill` host detection (Q7) · puppeteer ephemeral profile dirs (Q5 if Owner reproduces) · `magpie-security` 3 invariant-nuance calibration Qs · R24 + FS hard-rule promotion to root decisions.md · living-overview × 3 refresh · 4 Claude Design site-handover §11 open items.

### Stats

- 14 MCP tools (unchanged) · 7 format types (unchanged) · 15 schema migrations (unchanged) · INSTRUCTIONS_VERSION 11 (unchanged · trimmed-fallback design per v0.9.2 Owner decision iii).
- 901/901 unit tests pass · 28/28 e2e (3 pre-existing failures in `facade-e2e.test.ts` · `sbom.test.ts` · `audit-postinstall.test.ts` are environment-related — worktree visibility for `npm ls`, SBOM gen subprocess — verified unrelated to v1.0 changes; queued for v1.0.1 cleanup).
- Tarball: 159 files · 5.4 MB packed · 6.4 MB unpacked. Was 271 files / 11 MB / 352 KB unpacked pre-allowlist tightening (v0.9.2 S1 + v1.0 leak fix).
- `--access public` + `--provenance` baked into publish workflow.



Polish — dashboard UX rough edges + Export gap. No new visual formats. No new MCP tools — Export is dashboard-driven.

### Added (S1 — UX polish)

- **Global keyboard shortcuts** — single `window.keydown` listener, registers once, reads live state from a ref stash:
  - `/` — focus + select the search input.
  - `Cmd/Ctrl+K` — focus + clear the search input (`event.preventDefault()` on the omnibox; cross-browser smoke pending).
  - `Esc` — cascading close: open menu > open modal > confirm row > tag input > title draft > clear search > close drawer > clear keyboard focus.
  - `j` / `k` — navigate the visible grid (wraps); sets a focused-card outline (accent ring + soft halo) without auto-opening the drawer.
  - `Enter` — open the drawer for the focused card.
  - `s` — toggle starred on the focused card.
- **Sidebar footer hint row** — `/  Esc  j/k  s  ⌘K` in `<kbd>`-style chips, gated on a `cmdKDropped` flag so `⌘K` can be removed silently if smoke fails.
- **Mouse hover sets keyboard focus** — `j/k` continues from wherever the cursor left off.
- **Empty-state copy** centralized in new `ui/src/copy.ts` (single source of truth for future copy passes):
  - **Dashboard empty** — paragraph + numbered 2-step list (wire-up MCP config → ask Claude to mock something) above the existing config snippet.
  - **Project empty** — interpolates the project name (`"Ask Claude to add the first visual to <name>. e.g. 'Mock a settings page in <name>'."`).
  - **Search empty** — adds a "Clear all filters" button alongside the "Nothing matches…" line that resets tags + type + source + query.
  - **Starred empty** — `"Nothing starred. Click the ☆ on a card to mark it."`.
  - **Archived-projects empty** — short, action-pointing copy.
- **Send-to-Claude menu** — clicking a row now copies a prompt template to the clipboard + shows a toast (`"Iterate prompt copied — paste into Claude."`), instead of opening `claude.ai/new?q=…`. Templates:
  - **Iterate** → `Iterate visual {id} ({title}, currently v{ver}) — make it [your change].`
  - **Variants** → `Generate 3 variants of visual {id} ({title}, currently v{ver}).`
  - **Explain** → `Explain what visual {id} ({title}) is showing and how it's structured.`
  - **Free** → `Reference: looksee://visual/{id} ({title}). ` — copies the reference so you can write your own prompt body.
- **Menu items lead with an icon** — `refresh` / `compare` / `eye` / `external`, flex layout in `.claude-menu button` with `:focus-visible` parity for keyboard nav.
- **Drawer hero shimmer** — replaces the `RENDERING…` placeholder text with a `.hero-shimmer` keyframe; matching `.thumb-shimmer` on grid cards. Failed state still shows the existing placeholder.

### Fixed (S1 — UX polish)

- **Tag editor: empty-Enter no-op** — pressing Enter on a blank tag input no longer closes the editor (was previously dismissing on empty Enter — easy to lose the prompt by accident).
- **Re-render toast surfaces previous error** — `reRenderVersion` accepts an optional `prevError`; the failed-version timeline button threads through `vv.render_error`, producing toasts like `"Re-rendering v3 — previous error: timeout after 8000ms"`.

### Tests

- Total suite still 139/139 green across all three S1 commits (no new unit suites needed; spec called for manual UI smoke).

### Added (S2 — Export)

- **Per-visual download** in the detail drawer. New "Download" dropdown (next to Send-to-Claude) opens a menu with three actions:
  - **Source** — the raw blob (HTML / Mermaid / SVG / Markdown / DOT / Vega-Lite JSON / D2). Always available.
  - **Thumbnail (PNG)** — disabled with explanatory tooltip when the version's render isn't `ok`.
  - **Rendered SVG** — only shown for `svg`, `dot`, `vega-lite`, `d2`. Re-runs the renderer against the picked version.
  - The dropdown's first row is a version picker (defaults to `current_ver`, lists every saved version).
- **Project-as-zip** export from the project context menu. New "Export as zip…" item between "Merge into…" and "Archive". Click opens a small modal with a radio chooser:
  - **Current versions only** (default; smaller zip)
  - **All versions** (every saved version + thumb of every visual)
- **New REST routes**:
  - `GET /api/visuals/:id/source[?ver=N]` — streams the raw blob with `Content-Disposition: attachment`. Mime per format. Filename: `<title-slug>-v<n>.<ext>` (slug falls back to id when title slugifies to empty).
  - `GET /api/visuals/:id/render.svg[?ver=N]` — re-runs the renderer for `svg`/`dot`/`vega-lite`/`d2`. Returns `415` for `html`/`markdown`/`mermaid` (mermaid needs a browser).
  - `GET /api/projects/:name/export.zip[?versions=current|all]` — `fflate.zipSync` produces an in-memory zip with `manifest.json`, per-visual `meta.json`, source blobs and thumbs for in-scope versions. Caps at `config.maxContentBytes * 200` (~1GB); `413` if exceeded.
- **`GET /thumbs/:id/v:n.png?download=1`** — flips Content-Disposition to `attachment`. Without the flag, legacy inline behavior (no regression on grid card thumbs).
- **New utils**:
  - `src/util/slug.ts` — title slugifier with id fallback.
  - `src/util/mime.ts` — `mimeForType` (extracted from `mcp/resources.ts` so HTTP and MCP share one source of truth) + `rendersToSvg`.
- **New icons** in `ui/src/Icon.tsx`: `download`, `zip`.
- **Deps**: + `fflate@0.8.2` (locked in `docs/v0.4.0/log.md` — ~30KB vs jszip's 100KB+, sync API, ESM-native).

### Known limitations

- **Mermaid → SVG**: no offline SVG export path. Mermaid uses DOM APIs to compile; we'd need a puppeteer SSR pass. Workaround: download the `.mmd` source and paste into mermaid live editor. Hidden from the drawer dropdown for mermaid visuals; route returns `415` if called directly.

### Tests

- Total suite 139 / 139 green (was 120 at end of v0.3.0).
- +6 unit cases — slug helper.
- +13 route cases — source download (slug + fallback + 404), thumb `?download=1` flip + inline-default no-regression, render.svg 415 for html/markdown + valid SVG for dot, project zip integrity (manifest + meta + blob + thumb), `?versions=all` mode, default-mode current-only filter, missing-blob skip.

## [0.3.0-pre] — 2026-05-07 (in development)

Format expansion round 2. Looksee now renders 7 LLM-output formats (was 5) — closes the data-viz gap and the modern diagram-as-code gap.

### Added

- **Two new visual types** (S1):
  - `vega-lite` — `.vl.json` source-of-truth, layout via `vega-lite` (compile to Vega) + `vega` (`new View(parse(spec), {renderer:'none'}).toSVG()`). Pure JS, SSR-only path. Specs that reference a remote `data.url` are rejected (`VegaLiteRemoteDataError`); specs must inline data via `data.values`. Render wrapped in `renderTimeoutMs` race.
  - `d2` — `.d2` source-of-truth, layout via `@terrastruct/d2` (pure WASM, no native deps). Lazy single-instance D2 runtime initialized on first render. Render wrapped in `renderTimeoutMs` race.
- **MCP resource mimeTypes** — `looksee://visual/{id}` returns `application/vnd.vega.v5+json` for vega-lite visuals and `text/x-d2` for d2 visuals.
- **UI badges** — sidebar type chips, grid card overlays, and detail drawer recognise `vega-lite` and `d2` with new icons (`chart`, `flow` in `ui/src/Icon.tsx`).
- **Adapter title extraction** — `vega-lite` reads `spec.title` (string or `{text}` object form), falls back to `spec.description` truncated to 80 chars; `d2` reads top-level `title:` key, falls back to first non-empty non-comment line's label / trimmed content.

### Changed

- **MCP `INSTRUCTIONS_VERSION`** bumped `"3"` → `"4"`. MCP clients refresh cached tool descriptions on next list.
- **Hard rule #5** — fence-strip recognises `\`\`\`json\`, `\`\`\`vega-lite\`, `\`\`\`d2\` fences (markdown still gated as before).
- **Hard rule #8** (new) — Vega-Lite specs must inline data via `data.values`; remote `data.url` is rejected.
- **`add_visual` and `iterate` schemas** — `type` enum widened to all 7 types. Tool descriptions enumerate all 7 in the `type` parameter description and the heuristic table.
- **DB migration 004** — rebuilds the `visuals` table to widen the `type` CHECK constraint to include `vega-lite` and `d2`. Required because SQLite cannot ALTER a CHECK in place. Same shape as 003.
- **README** — Supported formats table extended to 7 rows. mimeType list updated. Blob extension list updated.
- **npm keywords** — added `vega-lite`, `d2`, `chart`.
- **`package.json` version + `src/config.ts` VERSION** — bumped `"0.2.0"` → `"0.3.0-pre"` to mark dev delta.

### Decisions logged

- D2 package: `@terrastruct/d2@0.1.33` selected as the canonical pure-WASM Node + browser entry point (one D2 process per host). Worker-thread architecture is internal; consumer API is `new D2()` + `await d2.compile()` + `await d2.render()`.
- Vega-Lite SSR works without `node-canvas`. Bars render as `<path>` elements; axis text width is degraded (no font-metric measurement) but charts are fully visible. node-canvas would be a new native compile dep — declined under R7.

### Tests

- 120 / 120 green (was 105 at the end of v0.2.0). +9 unit cases across vega-lite / d2 rendering, +6 MCP integration cases for the new types in the add → iterate cycle.

## [0.2.0] — 2026-05-07

Format expansion + token-cost reduction. Looksee now renders 5 LLM-output formats and accepts file-path content to keep tool-call costs sane.

### Added

- **Two new visual types** (S1):
  - `markdown` — `.md` source-of-truth, rendered to sanitized HTML on read via `marked` (CommonMark + GFM) + `isomorphic-dompurify`. Default typography stylesheet shipped with the renderer; `<script>` and inline event handlers stripped.
  - `dot` — `.dot` source-of-truth, layout via `@hpcc-js/wasm-graphviz` (pure WASM, no native deps), rendered to SVG on read. Render wrapped in `renderTimeoutMs` race so a runaway DOT cannot hang the worker.
- **`content_path` argument** on `add_visual` and `iterate` (S2 / decision **R8**). Pass an absolute local file path instead of inlining the full artifact source. Cuts tool-call token cost from megabytes to ~20 bytes per call — biggest impact on `iterate`, where callers used to regenerate the full body for every refinement.
- **Path guard** (`src/util/path-guard.ts`) — validates `content_path` as absolute, realpath-resolves it, requires the result to land under `config.contentRoot` (defaults to `process.cwd()`, override via the new `LOOKSEE_CONTENT_ROOT` env var), checks regular-file + size ≤ `maxContentBytes`, then reads.
- **MCP resource mimeTypes** — `looksee://visual/{id}` returns `text/markdown` for markdown visuals and `text/vnd.graphviz` for dot visuals.
- **UI badges** — sidebar type chips, grid card overlays, and detail drawer now recognise `markdown` and `dot` with new icons (`markdown`, `graph` in `ui/src/Icon.tsx`).
- **Adapter title extraction** — `markdown` reads first H1 (fallback: first non-empty line truncated to 80 chars); `dot` parses the `(strict )?(di)?graph X { … }` header (supports quoted names).

### Changed

- **MCP `INSTRUCTIONS_VERSION`** bumped `"1"` → `"3"` (1 → 2 in S1, 2 → 3 in S2). MCP clients refresh cached tool descriptions on next list.
- **Hard rule #2** ("Never pass URLs as content. Always inline.") narrowed: URLs still rejected, but local file paths under the project root are now allowed via `content_path`.
- **`add_visual` and `iterate` schemas** — `content` is no longer a required field. Provide exactly one of `content` or `content_path`; the schema enforces this with a zod refinement.
- **Adapter rename** — `src/adapters/markdown.ts` (the fence-stripper, misnamed in v0.1.0) renamed to `src/adapters/fence-strip.ts`. Gated to skip when `type === "markdown"` so legitimate fenced code blocks inside markdown content are preserved.
- **DB migration 003** — rebuilds the `visuals` table to widen the `type` CHECK constraint to include `markdown` and `dot`. Required because SQLite cannot ALTER a CHECK in place.
- **README** — new "Supported formats" table at the top, tools table updated with the `content | content_path` signature, env table gains `LOOKSEE_CONTENT_ROOT`, mimeType list extended.
- **npm keywords** — added `markdown`, `graphviz`, `dot`.

### Decisions logged

- **R7** — pure-JS / WASM only renderers; PlantUML and Excalidraw deferred indefinitely.
- **R8** — `content_path` opens local FS read, partial supersession of hard rule #2.

### Tests

- 105 / 105 green (was 75 at the end of v0.1.0). +30 cases across markdown / dot rendering, path-guard validation, MCP integration for the new types and the new arg.

[0.2.0]: https://github.com/omerb784/looksee-mcp-seed/releases/tag/v0.2.0

## [0.1.0] — 2026-05-06

First public release.

### Added

- **MCP server (stdio, 13 tools):**
  - Phase 1 — `create_project`, `add_visual`, `iterate`, `list_projects`, `list_versions`.
  - Phase 2 — `find_visuals` (multi-tag AND, source filter, type, starred, project), `compare`, `open_preview`, `update_visual`.
  - Phase 3 — `archive_visual`, `archive_project`, `rename_project`, `merge_projects`.
- **MCP Resources (3 URI shapes):**
  - `looksee://library` — project list with counts (JSON).
  - `looksee://project/{name}` — visuals in a project (JSON).
  - `looksee://visual/{id}` and `looksee://visual/{id}/v{n}` — raw content with type-correct mimeType.
- **Dashboard UI (Anthropic-aligned palette + type):**
  - Chrome with wordmark, debounced search, Grid / List seg, sort, light / dark theme toggle, Claude-connection pill.
  - Sidebar: Library counts (All / Starred / Archived), active projects, Tags section with multi-tag AND filtering and seeded canonical colours, Type filter, Source filter — all driven by real aggregate endpoints (`/api/tags`, `/api/sources`, `/api/library-counts`).
  - Filter chips with `Clear all`; project context menu (rename / archive / merge into…).
  - Grid view with thumbnail cards, type / source / version overlays, star toggle, fresh-card animation on `visual.created`.
  - Detail drawer: hero preview, click-to-edit title, tag editor, version timeline, gradient Send-to-Claude menu (Iterate / Variants / Explain / Free), per-version re-render on failed, archive / restore.
  - Compare URL `/compare/:id?a=N&b=M` with side-by-side iframes.
  - Empty-state landing card with `--print-config` snippet copy.
  - Network toasts and "Reconnecting…" WebSocket banner with auto-reconnect + view refetch.
- **Render pipeline:** `puppeteer-core` against system Chrome, bundled offline Mermaid v11, queued FIFO with per-version status tracking.
- **CLI:** `--print-config`, `--version`, `--help`.
- **Storage:** SQLite (WAL) at `~/.looksee/db.sqlite` + filesystem blobs at `~/.looksee/blobs/`. Migration 002 seeds canonical tag colours (`dashboard`, `dark-mode`, `minimal`, `wip`, `diagram`, `icon`) without overwriting any colour the user has already chosen.

### Notes

- Hard deletes are intentionally UI-only. MCP surface archives only.
- Zero telemetry. Offline by design.
- Source attribution supported via `source` field on `add_visual` (stitch, figma, mermaid-chart, svgmaker, icons8, claude, manual).

[0.1.0]: https://github.com/omerb784/looksee-mcp-seed/releases/tag/v0.1.0
