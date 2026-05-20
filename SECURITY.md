# Security policy — magpie-mcp

This document describes Magpie's security boundary: every place the process
spawns, listens, writes, or runs an install-time script. Exact paths, exact
args, exact byte counts. No marketing copy.

Magpie is **local-only**. It opens loopback ports (127.0.0.1), reads/writes
inside a single per-user directory, and exposes one stdio MCP transport to its
host process (Claude Code / Cursor / Cline). It never makes outbound network
requests. It never speaks to any remote service.

---

## Threat model

Magpie's threat model is "untrusted visual content on a trusted local
machine." The Owner runs Magpie locally as a per-user process. The Owner's
host process (Claude Code, Cursor, Cline) writes visual content into Magpie
via MCP. That content is potentially adversarial — Claude can be prompt-
injected from an upstream document or a previously-cached file — but the
process boundary is the OS user account.

In scope:

- A malicious HTML/SVG/mermaid/markdown visual cannot reach Magpie's HTTP
  API from inside its preview iframe.
- A malicious tag name, project name, or visual title cannot SQL-inject
  the SQLite database.
- A user on the same machine in a different account cannot connect to
  Magpie's MCP IPC pipe/socket.
- A directory traversal or symlink escape on a `content_path` argument
  cannot read files outside the configured content root (R8).
- Magpie cannot leak the OS username through stderr logs.

Out of scope:

- A user in the SAME OS account running malicious code. They already have
  the same rights as Magpie itself.
- A compromise of better-sqlite3, puppeteer-core, Chrome itself, or any
  other transitive dependency. We pin and audit (see "Dependencies" below)
  but do not paper over upstream RCE.
- Network attackers. Magpie does not listen on a public interface (see
  "Listeners" below) and makes no outbound calls.

To report a vulnerability: email `omerb784@gmail.com` with subject
`magpie-mcp security`, or open a GitHub Security Advisory at
`https://github.com/omerb784/magpie-mcp/security/advisories` once the
repo is public (deferred to v1.0). Include reproduction steps and Magpie
version (`magpie-mcp --version`).

---

## Spawns (every place Magpie creates a child process)

1. **Canonical fork** — `src/lifecycle/lock.ts`. The first `magpie-mcp`
   invocation per OS user becomes the canonical; later invocations become
   facades that forward MCP frames to the canonical over an IPC pipe.
   No external command — the same Node binary continues.

2. **Chrome via puppeteer-core** — `src/render/browser.ts`. Spawns the
   user-installed Chrome (or Chromium/Edge fallback) found via the
   `MAGPIE_CHROME_PATH` env var or platform-default search paths. Launch
   args are pinned in `HARDENED_CHROME_ARGS` (10 flags):

   ```
   --disable-dev-shm-usage  --disable-gpu  --hide-scrollbars
   --disable-extensions  --no-first-run  --no-default-browser-check
   --disable-background-networking  --disable-sync
   --metrics-recording-only  --disable-breakpad
   ```

   `--no-sandbox` and `--disable-setuid-sandbox` are **explicitly absent**.
   The Chrome renderer sandbox is the load-bearing OS isolation if a Chrome
   renderer RCE is ever found. Chrome runs in an isolated user-data dir at
   `<MAGPIE_HOME>/.render-profile/` — never the Owner's regular Chrome
   profile.

3. **`--install-skill`** — `src/cli/install-skill.ts`. Writes exactly one
   file at `<HOME>/.claude/skills/magpie-master/SKILL.md`. Does nothing
   else. Idempotent on hash-equal. Bounded-write asserted by
   `src/cli/install-skill-bounded.test.ts` (7 tests using before/after
   filesystem diff). Reversed by `--uninstall-skill`.

---

## Listeners (every TCP/IPC port Magpie opens)

1. **HTTP dashboard + Resources** — bound to `127.0.0.1` (loopback only).
   Port auto-picked from `MAGPIE_PORT` (default 3737), scans up 100 ports
   on conflict. Asserted by `src/http/binding.test.ts`. The Origin/Host
   guard middleware in `src/http/middleware/origin-guard.ts` rejects any
   request whose `Host` or `Origin` header doesn't match the allowlist
   `{127.0.0.1, localhost, [::1]}` — DNS rebind defeat.

2. **WebSocket upgrade** — same `nodeServer` as HTTP. The
   `verifyClient` callback in `src/http/ws.ts` runs the same Origin/Host
   checks before the WS handshake completes. Asserted by
   `src/security/ws-origin-guard.test.ts`.

3. **IPC pipe (Windows) / Unix domain socket** — `src/lifecycle/lock.ts`.
   On Windows: `\\.\pipe\magpie-<hash>` where `<hash>` is the first 12
   hex chars of `sha1(MAGPIE_HOME)`. Pipe DACL inherits from the creating
   process token (non-elevated session → creator + SYSTEM + Admins).
   On Unix: `<TMPDIR>/magpie-<hash>.sock`, chmod'd to `0o600` immediately
   after listen — owner RW only, group + other denied. Asserted by
   `src/lifecycle/canonical-acl.test.ts`.

---

## Writes (every place Magpie writes to disk)

All writes land under one of two trees:

1. **`MAGPIE_HOME`** (default `~/.magpie/`) — owns:
   - `magpie.db` (SQLite database)
   - `blobs/<visual-id>/v<n>.<ext>` (visual version content)
   - `last-port` (last-bound HTTP port, single line)
   - `.render-profile/` (Chrome user-data dir, see Spawns)

2. **`<HOME>/.claude/skills/magpie-master/SKILL.md`** — only via
   `--install-skill`. Single file. Documented above.

The path guard `readContentPath()` in `src/util/path-guard.ts` (R8)
enforces `realpath()`-canonicalized containment under `MAGPIE_CONTENT_ROOT`
(default = process cwd) for every `content_path` argument fed via MCP.
Symlink escape, UNC long-form, NUL-byte, `..` traversal: all rejected.
Asserted by `src/util/path-guard.test.ts` + `path-guard-hardening.test.ts`
(14 tests).

---

## Install-time scripts

Magpie's own `package.json` declares **zero** `preinstall`, `install`, or
`postinstall` scripts. The audit `scripts/audit-postinstall.mjs` walks
`npm ls --omit=dev --all --parseable` on every publish and rejects any
production package that adds an install-time script, except this one:

- **`better-sqlite3`** — `install` script is `prebuild-install || node-gyp
  rebuild`. Downloads a prebuilt native binary from
  `https://github.com/WiseLibs/better-sqlite3/releases` matching the
  current Node ABI + platform, with a fallback to building from source if
  no prebuild is available. This is the SQLite native binding. Magpie
  ships with no other native modules.

The audit script also runs `npm pack --dry-run` and rejects any tarball
file that matches `.map`, `*.test.*`, `__tests__/`, `tests/`, `.tmp-*/`,
`.env*`, `fixture[s]/`, `.git*`, `scratch/`, `.vscode/`, `.idea/`,
`coverage/`, `.DS_Store`, `Thumbs.db`, or `*.log`. Asserted by
`src/security/check-tarball.test.ts` (7 tests).

Current published tarball: 105 files, 352 KB unpacked, 101 KB packed.

---

## Visual rendering

Every visual preview loads inside `<iframe sandbox="allow-scripts">` with
**no `allow-same-origin`**. The iframe is in a null origin, so any
`fetch('/api/...')` from inside the iframe is treated as a cross-origin
request and rejected by the Origin guard. Owner decision v lean
(2026-05-14): "there is no need at all to run javascript on magpie from
visual — we have mcp and llm for that."

The `/v/:id?chrome=0` HTTP routes that serve the iframe content all set
Content-Security-Policy headers (`src/http/routes/visuals.ts:previewCsp`):

- `svg`: `default-src 'none'; img-src data:; style-src 'unsafe-inline'`
  (no script-src — an SVG with `<script>` cannot execute).
- `html` and all renderer-backed types: `default-src 'self' data: blob:;
  style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none';
  frame-ancestors 'self'`. `connect-src 'none'` blocks all
  fetch/XHR/WebSocket/EventSource from inside the iframe.

Asserted by `src/security/visual-csp.test.ts` (9 tests) +
`src/http/routes/preview-chrome.test.ts:pane sandbox + postMessage bridge`.

---

## SQL injection

Every `db.prepare(...)` call site under `src/store/` and `src/` uses
parameter binding (`?` placeholders bound via `.run(...)` or `.get(...)`).
Three sites use template-literal SQL strings (`prepare(\`... ${} ...\`)`)
but interpolate only hardcoded fragments or `?`-placeholder chars, never
user data. Asserted by `src/security/sql-injection.test.ts` (8 tests
feeding 10 classic payloads through every public mutator).

---

## Error contract

Magpie returns **two distinct error channels** over MCP. The split is
deliberate — clients distinguish them, and a future "structured error
codes" envelope is explicitly rejected (Owner decision i, v0.9.2 Phase C).

1. **Protocol-level failures** use the JSON-RPC `error` envelope. Magpie
   throws `McpError(code, message)` from a request handler when the call
   is malformed at the protocol layer — unknown resource URI, unknown
   prompt name, prompt-args fail Zod. The SDK turns these into JSON-RPC
   errors with structured `code` + `data` fields.

2. **Semantic / domain failures** use `{ isError: true }` on a successful
   `CallToolResult`. The call succeeded at the protocol layer; the
   operation didn't apply. Visual not found, version doesn't exist,
   `content_path` rejected by R8 path guard, adapter rejected content,
   content exceeds `maxContentBytes`. Magpie returns these via
   `textResult(message, true)` — a model-readable prose string the
   upstream LLM reads, repairs, and retries from.

Tool errors are **prose, not structured codes**. There is no
`{ error_code, error_kind, hint, retry }` JSON envelope. The motivation
for the deferred F4 hopper (structured error codes during S3 walkthrough,
2026-05-11) was "LLM mis-recovery from terse prose." After review at
Phase C open, the Owner locked the policy as **prose-only**: every prose
message names the failure mode in human-readable form
("Unknown visual_id: ...", "content_path rejected (outside_root): ...",
"Render: failed — see dashboard"). The LLM reads, the LLM repairs.
Adding a structured envelope would lock a contract that clients then
have to schema-validate, raising the integration cost without evidence
that the prose surface fails in practice.

**Future revisit trigger.** If prod telemetry surfaces a pattern of LLM
mis-recovery (repeated identical failing calls, gibberish retries from
parsing terse prose, prose strings hitting the model context budget),
re-open at v0.9.3 Phase F or later. Until then F4 stays closed.

See `src/mcp/server.ts:CallToolRequestSchema-handler` for the
catch-all wrapper, and the convention comment block above the
`ReadResourceRequestSchema` handler for the protocol-vs-semantic split.

---

## Dependencies

- `.github/dependabot.yml` opens weekly PRs for npm + github-actions
  ecosystems. Minor/patch updates are grouped; majors get one PR each.
- `npm audit --omit=dev --audit-level=high` runs in `prepublishOnly` and
  in the publish workflow before `npm publish`. Current tree: 0 high,
  0 critical, 4 moderate (tracked for triage).
- A CycloneDX 1.5 SBOM is generated by `scripts/generate-sbom.mjs` on
  every publish and uploaded as a workflow artifact with 90-day retention.

---

## GitHub Actions

All three workflows (`ci.yml`, `publish.yml`, `deploy-site.yml`) pin
every third-party action to a commit SHA, not a floating tag. `ci.yml`
and `publish.yml` keep workflow-scope `permissions:` at `contents: read`
(the publish workflow adds `id-token: write` at job scope, required by
`npm publish --provenance` OIDC attestation); `deploy-site.yml` uses
`contents: write` to push the built site to the `gh-pages` branch. No
`pull_request_target` triggers anywhere — fork-escalation surface is empty.

Publish trigger is `push: tags v1.*` only. The current v0.x line never
publishes to npm.

---

## Version

This document covers magpie-mcp **v1.0.0**. The threat model and
listener inventory above were established by the v0.9.2 prod-readiness
audit and re-verified for the v1.0 release.
