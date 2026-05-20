---
name: magpie-master
description: Master decision protocol for the Magpie MCP server. Use when working with magpie, magpie-mcp, add_visual, iterate, find_visuals, or any tool that deposits visuals into the nest. Defines when to file silently, when to iterate vs add, when to stop and ask the Owner about new projects or ambiguous matches.
version: 1.0.1
---

# Magpie master — decision protocol

You are the **master**. The **magpie** is your bound MCP server. The **nest** is where its shinies live, served on a local dashboard URL. The **Owner** opens the browser tab to browse, tag, compare, and export.

> Master tells. Magpie fetches. Nest keeps.

When you produce a visual (HTML mockup, mermaid diagram, SVG, markdown doc, DOT graph, Vega-Lite chart, D2 diagram) for the Owner: **deposit it in the nest by default**. This protocol governs *when to deposit*, *when to iterate*, and *when to stop and ask the Owner*.

The asymmetry to remember: filing wrong wastes seconds (the Owner archives or retitles in the dashboard). Asking wrong breaks the Owner's flow (paperwork prompts in the middle of creative work). **Default to filing silently. Interrupt the Owner only when filing wrong is worse than asking.**

## Session priming — first tool call

On the first tool call of a session:

1. Read `magpie://library` — know which projects exist before you draft anything.
2. Read `magpie://inbox` — the Owner may have queued prompts from the dashboard. Pick those up before starting new work.

Both reads are cheap (one round-trip each). Skip only if you've already done them this session.

## The decision tree

Run this every time you produce a visual. Branches in order: top wins.

```
1. Did the Owner say "don't save" / "just show me" / "skip the magpie"?
   → produce inline · skip add_visual · the next visual resumes default-file.

2. Are you modifying a visual the Owner accepted earlier in this session?
   → iterate(visual_id, content_path, message?). Always full content.
     Never call add_visual when iterate is right.

3. Did the Owner reference past work ambiguously? ("the homepage one")
   → find_visuals(query: …).
     0 matches → treat as new (continue to step 4).
     1 match  → use it.
     2+ matches → STOP and ask which (list with id + title).

4. Does the visual fit a project that already exists?
   → add_visual(project, type, content_path).
     Match priority: Owner's earlier stated project > cwd basename > topic.
     "Already exists" comes from magpie://library (read at session start).

5. About to create a new project?
   → STOP. Propose name + type. Wait for the Owner's confirmation
     before calling create_project. (Most adds auto-create; only stop
     when you're explicitly proposing a new project.)
```

## Six canonical scenes

### Scene 1 · First visual in a new session — GREEN, file silently

**Signal:** empty session, cwd-detected project candidate, Owner's first creative ask.

**Owner:** *"draw me a login page."*

**Master:** `list_projects()` → match cwd basename → `add_visual("myapp", "html", content_path: "...")`. No question. File it.

If no cwd match: probe `magpie://library` for a topic-fit project. Found → use it. Not found → continue to Scene 5.

### Scene 2 · Iterate on previous visual — GREEN, iterate silently

**Signal:** recent `visual_id` in session memory + verb signals modification ("bigger", "darker", "smaller", "fix the typo", "make it dark mode").

**Owner:** *"make the button bigger."*

**Master:** `iterate(visual_id: "<remembered>", content_path: "...")`. New version `v2` added; `v1` preserved. Never `add_visual` here.

### Scene 3 · Topic shift mid-session — AMBER, probe then decide

**Signal:** new format or different domain from previous visuals, no clear iterate target.

**Owner:** working in "myapp" mockups, now asks *"draw me a system architecture diagram."*

**Master:** read `magpie://library`. Is there a fitting project (`myapp-arch` · `architecture` · `system`)? Yes → `add_visual` there. No → ask Owner once: *"This is a system diagram — start a new project `myapp-architecture` (type: diagram), or fit it into `myapp`?"*

### Scene 4 · Ambiguous reference to past work — AMBER, search then decide

**Signal:** Owner names something vaguely ("the homepage one", "that diagram from earlier").

**Master:** `find_visuals(query: "homepage")`.
- 1 match → use it (iterate or reference).
- 2+ matches → STOP. List candidates as `id + title + project + last-updated`. Ask which.
- 0 matches → ask Owner to clarify, or treat as new creation (back to the decision tree top).

### Scene 5 · About to create a new project — RED, stop and confirm

**Signal:** no matching project found; the visual implies a durable structure.

**Master action:** STOP. Propose explicitly and wait.

> *"I'd start a new project called `myapp-architecture` (type: diagram). Sound right, or use an existing one?"*

Projects clutter the Owner's sidebar forever. They are durable — auto-delete is not a thing. Confirm name + type before `create_project`.

### Scene 6 · Owner explicitly opts out — RED, respect the override

**Signal:** *"don't save this"* · *"just show me"* · *"skip the magpie"* · *"this is throwaway"*.

**Master action:** produce the visual inline only. Do **not** call `add_visual`. Next visual in the session resumes the default-file behavior unless the Owner re-states the opt-out.

## Stop-and-ask · file-silently — explicit rules

### STOP and ask the Owner

- **About to create a new project.** Propose name + type. Wait for confirmation. `create_project` is durable.
- **2+ ambiguous matches** on a referenced visual. List `id + title + project` and let the Owner pick.
- **Topic shift to an unmatched domain** with format change (mockups → diagrams). Probe library first; ask only if no candidate found.
- **Owner's last message contradicts** what you're about to do ("don't save this one yet" vs default-file). Defer to the latest message.
- **About to archive or merge** projects. Even though both are reversible, the Owner's mental model treats them as deletes.

### DECIDE and file silently

- **First visual of session** with a cwd-matched project. Auto-file.
- **Iterate on the most-recent `visual_id`** when verbs signal change. Use `iterate`, not `add_visual`.
- **Single match on `find_visuals`.** Proceed.
- **Same project, same format** as the previous visual. Keep going, no probe.
- **Owner explicitly stated a project name earlier** ("we're in `myapp-v2` today"). Use it for all subsequent adds without re-asking, until the Owner says otherwise.
- **Title and tag enrichment after `add_visual`.** Infer a concise title from the prompt intent and call `update_visual` immediately. Apply `wip` tag on first add; the Owner promotes to `final` or `approved` later via the dashboard.

## Six anti-patterns to avoid

### 1. Project sprawl

You create `project-1`, `untitled-2`, `new-mocks-3` because cwd didn't match cleanly. The Owner ends up with an unusable sidebar.

**Fix:** Scene 5. Never `create_project` without confirming name + type.

### 2. Duplicate visuals on iterate-vs-add miss

Owner says *"make it darker"* and you call `add_visual` instead of `iterate`. Now there are two near-identical mocks the Owner has to manually link.

**Fix:** Scene 2. Verb-change signals → `iterate(visual_id)`.

### 3. Re-asking the project on every visual

You ask *"which project should this go in?"* five times in a session. The Owner's flow breaks; Magpie feels like paperwork.

**Fix:** Sticky session project. Only re-probe on a real topic shift or format change.

### 4. Silently filing throwaways

You default-file every transient sketch, even when the Owner clearly wanted a quick *"what if?"* inline. The nest fills with noise.

**Fix:** Scene 1 + Scene 6. Respect the *"don't save"* signal. Default-file only on visuals the Owner is actually working with.

### 5. Title drift — empty or generic titles

You add visuals with title `"Untitled"` or copy the first six words of the prompt verbatim. The library becomes unsearchable.

**Fix:** Infer a concise, descriptive title from prompt intent. Call `update_visual` immediately after `add_visual` to set title + tags.

### 6. Ignoring the inbox

The Owner queues *"draw me a v3 of the dashboard with the new metrics"* from the dashboard. You never read `magpie://inbox` and the queued prompt rots.

**Fix:** Read `magpie://inbox` at session start. Process queued prompts before drafting new work. `read_inbox` auto-marks consumed in the same call.

## v1.0 deltas — context the master should carry

### Seed project awareness (Q4 C)

On first-install dashboards, the Owner may see an empty-state CTA with two buttons:
- **Primary:** "Ask Claude to create your first visual" — that's the cue to you (the master).
- **Secondary:** "Load example project" — clicking this loads a pre-built `user-guide` project with ~5 demo visuals (one per format) from a bundled JSON manifest.

What this means for you:

- **Don't create a `user-guide` project yourself.** If the Owner needs the example loaded, they click the dashboard button. The endpoint is dashboard-only (no MCP tool exposed for seed-import per Owner constraint — MCP tool surface stays at 14 tools).
- **Don't iterate seed visuals as if they were Owner work.** If the Owner asks *"make me a CRM dashboard"* right after loading the example, you `add_visual` to a *new* fit project — you do NOT iterate one of the seeded user-guide visuals.
- **Treat seeded visuals as Owner-archivable demo content.** If the Owner says *"this example is in the way, get rid of it"* — that's an `archive_visual` or dashboard-side delete decision. Don't proactively archive.
- **`user-guide` project as a name** is reserved-by-convention. If you're tempted to propose `user-guide` for a new Owner project in Scene 5, pick a different name to avoid collision.

### R19 multi-host context

Magpie runs as **one canonical process per machine**. Multiple hosts (Claude Code, Claude Desktop, Cursor concurrent) attach as facades. The dashboard URL is stable across canonical promotions (last-port pin).

What this means for you:

- **Don't be confused by `CANONICAL_RESTART (-32099)` errors.** They mean the canonical died and a facade is promoting. Retry the call once (already covered in Failure recovery). The dashboard URL stays the same; in-flight HTTP requests on the dashboard side handle the brief reconnect via WS.
- **If the Owner mentions running Magpie in two hosts at once**, that's expected behavior, not a misconfiguration. They'll see one shared library across hosts because all facades write to the same canonical DB.
- **`read_inbox` is your warm handoff across hosts.** A prompt queued from the dashboard in one host appears in `magpie://inbox` for whichever master picks it up first.

### R23 tagline language

When you produce Owner-facing prose (commit messages, status reports, response copy when the Owner asks about Magpie's behavior), use the brand tagline if relevant:

> **Your loyal Magpie.** Lands every visual in the nest.

Don't paraphrase as *"draws"* or *"catches"* or *"collects"* — the verb **"lands"** is locked (R23, 2026-05-16).

### Seed-vs-add disambiguation

Owner just loaded the example project. Dashboard now shows `user-guide` with 5 visuals. Owner asks *"make me a system architecture diagram."*

**Wrong:** iterate one of the seeded visuals because the project is the "most recent" one in the library.
**Right:** This is a fresh creative ask. Run the decision tree from step 1 as usual. If no fitting project exists, this is Scene 5 — propose a new project (NOT `user-guide`) and confirm with Owner.

The example project is *reference content*, not the Owner's working surface. Their working surfaces are projects they (or you, with confirmation) create.

## Quick reference — tool surface used by this protocol

| Surface | Used for |
|---|---|
| `magpie://library` | Session priming. Knowing which projects already exist. |
| `magpie://inbox` | Session priming. Picking up Owner-queued prompts. |
| `list_projects()` | Same as library, with last-activity. Cheap. |
| `find_visuals(query, project?, tags?, type?)` | Scene 4. Ambiguous reference resolution. |
| `add_visual(project, type, content_path, …)` | Default-file action. Always prefer `content_path` over inline `content`. |
| `iterate(visual_id, content_path, message?, description?)` | Scene 2. Verb-change modifications. Full content, never a diff. `message` is a one-liner version note (≤500 chars; long changelogs will error with `too_big`). For per-version rationale (what you tried, why this approach), use `description` on the same iterate call (≤2000 chars; set-once, not retro-editable). For whole-visual prose, use `update_visual(visual_id, description=…)` instead. |
| `update_visual(visual_id, title?, tags?, description?, starred?)` | Post-add enrichment. Title + `wip` tag. |
| `create_project(name, type, description?)` | Scene 5 only. Always confirmed by the Owner. |
| `read_inbox(count?, id?)` | Session priming if `magpie://inbox` is non-empty. |

## What this protocol does NOT change

- **Magpie does not generate.** You write the visual content. Magpie organizes it.
- **The dashboard is view-only.** The Owner browses, tags, stars, compares, exports there — but entity creation flows through you (the master) via the MCP tools.
- **Hard rules from the MCP `instructions` string still apply.** Never invent `visual_id`. Never pass URLs as `content`. Markdown fences are stripped automatically. Vega-Lite specs must inline `data.values`. Render failures still save the row with a flag.

## Failure recovery

- **Tool call returns `CANONICAL_RESTART` (-32099, retryable: true):** Magpie's canonical process died and a facade is promoting. Retry the call once. Don't ask the Owner.
- **Tool call returns a validation error:** read the error message, adjust args, retry. Don't escalate to the Owner unless the error is structural (e.g., requesting a nonexistent visual_id).
- **`add_visual` succeeds but the dashboard preview fails to render:** the row is saved with a render-failure flag. Tell the Owner; direct them to the dashboard URL to inspect.

---

*Skill bundled with `magpie-mcp` npm package. Version locks to the package version. Install via `npx magpie-mcp --install-skill`. Last protocol revision: v1.0.0, 2026-05-18 — added v1.0 deltas (seed CTA awareness · R19 multi-host context · R23 tagline language · seed-vs-add disambig). Per Owner constraint, MCP tool surface unchanged (14 tools).*
