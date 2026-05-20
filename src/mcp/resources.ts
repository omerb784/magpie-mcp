import { countInbox, listInbox } from "../store/inbox.js";
import { findByName, listProjects } from "../store/projects.js";
import { tagsForVisual } from "../store/tags.js";
import { listForVisual } from "../store/versions.js";
import { getVisual, listVisualsForProject } from "../store/visuals.js";
import { getBaseUrl } from "../runtime.js";
import { mimeForType } from "../util/mime.js";

// Cap the projects fanned out into listResources() so the MCP host's first
// turn doesn't pay for a 200-project library. Top-N by recency (listProjects()
// is already ORDER BY last_activity DESC), plus a single synthetic
// `magpie://library/more` sentinel when the cap is exceeded. Decision v
// (v0.9.2 Phase C / M5). Cursor pagination defers to v0.9.3 if a power-user
// signal emerges.
export const LIST_RESOURCES_PROJECT_CAP = 20;
export const MORE_PROJECTS_URI = "magpie://library/more";

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
}

export function listResources(): ResourceDescriptor[] {
  const out: ResourceDescriptor[] = [
    {
      uri: "magpie://library",
      name: "Magpie library",
      description: "All non-archived projects with visual counts.",
      mimeType: "application/json",
    },
    {
      uri: "magpie://inbox",
      name: "Magpie inbox",
      description: `Queued prompts from the dashboard. ${countInbox("pending")} pending · ${countInbox("consumed")} consumed.`,
      mimeType: "application/json",
    },
  ];
  const projects = listProjects();
  const capped = projects.slice(0, LIST_RESOURCES_PROJECT_CAP);
  for (const p of capped) {
    out.push({
      uri: `magpie://project/${encodeURIComponent(p.name)}`,
      name: `Project: ${p.name}`,
      description: `${p.visual_count} visual(s). Last activity ${p.last_activity}.`,
      mimeType: "application/json",
    });
  }
  const overflow = projects.length - capped.length;
  if (overflow > 0) {
    out.push({
      uri: MORE_PROJECTS_URI,
      name: `+${overflow} more projects`,
      description: `${overflow} additional project(s) not listed here. Open the Magpie dashboard for the full library.`,
      mimeType: "application/json",
    });
  }
  return out;
}

export interface ReadOk {
  ok: true;
  uri: string;
  mimeType: string;
  text: string;
}
export interface ReadErr {
  ok: false;
  reason: string;
}
export type ReadResult = ReadOk | ReadErr;

export function readResource(uri: string): ReadResult {
  const parsed = parseMagpieUri(uri);
  if (!parsed.ok) return parsed;

  if (parsed.kind === "inbox") {
    const enrich = (e: ReturnType<typeof listInbox>[number]) => {
      const v = e.visual_id ? getVisual(e.visual_id) : null;
      return {
        id: e.id,
        visual_id: e.visual_id,
        visual_title: v?.title ?? null,
        template_id: e.template_id,
        prompt_body: e.prompt_body,
        vars: e.vars,
        created_at: e.created_at,
        consumed_at: e.consumed_at,
      };
    };
    return {
      ok: true,
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        {
          pending: listInbox({ status: "pending", limit: 200 }).map(enrich),
          consumed: listInbox({ status: "consumed", limit: 200 }).map(enrich),
        },
        null,
        2
      ),
    };
  }

  if (parsed.kind === "library") {
    const projects = listProjects().map((p) => ({
      name: p.name,
      type: p.type,
      description: p.description,
      visual_count: p.visual_count,
      last_activity: p.last_activity,
    }));
    return {
      ok: true,
      uri,
      mimeType: "application/json",
      text: JSON.stringify({ projects }, null, 2),
    };
  }

  if (parsed.kind === "library-more") {
    const total = listProjects().length;
    const count = Math.max(0, total - LIST_RESOURCES_PROJECT_CAP);
    return {
      ok: true,
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        { kind: "more", count, dashboard_url: getBaseUrl() },
        null,
        2
      ),
    };
  }

  if (parsed.kind === "project") {
    const project = findByName(parsed.name);
    if (!project) return { ok: false, reason: `project "${parsed.name}" not found` };
    const visuals = listVisualsForProject(project.id).map((v) => ({
      id: v.id,
      title: v.title,
      type: v.type,
      description: v.description,
      current_ver: v.current_ver,
      starred: !!v.starred,
      tags: tagsForVisual(v.id).map((t) => t.name),
    }));
    return {
      ok: true,
      uri,
      mimeType: "application/json",
      text: JSON.stringify(
        { project: project.name, description: project.description, visuals },
        null,
        2
      ),
    };
  }

  // visual — return a pointer to the blob file, not its inline body.
  // The host should use the Read tool on `content_path` to load content on
  // demand. Keeps the resource response tiny and avoids burning tokens on
  // every read (visuals can be 100+ KB of HTML).
  const visual = getVisual(parsed.id);
  if (!visual) return { ok: false, reason: `visual ${parsed.id} not found` };
  const versions = listForVisual(visual.id);
  const ver = parsed.version ?? visual.current_ver;
  const target = versions.find((x) => x.version_num === ver);
  if (!target) return { ok: false, reason: `version ${ver} not found for visual ${visual.id}` };
  return {
    ok: true,
    uri,
    mimeType: "application/json",
    text: JSON.stringify(
      {
        visual_id: visual.id,
        version_num: target.version_num,
        type: visual.type,
        content_mime: mimeForType(visual.type),
        content_path: target.content_path,
        message: target.message,
        description: target.description,
      },
      null,
      2
    ),
  };
}


type Parsed =
  | { ok: true; kind: "library" }
  | { ok: true; kind: "library-more" }
  | { ok: true; kind: "inbox" }
  | { ok: true; kind: "project"; name: string }
  | { ok: true; kind: "visual"; id: string; version: number | null }
  | { ok: false; reason: string };

function parseMagpieUri(uri: string): Parsed {
  if (!uri.startsWith("magpie://")) {
    return { ok: false, reason: `not a magpie:// URI: ${uri}` };
  }
  const rest = uri.slice("magpie://".length);
  if (rest === "library/more" || rest === "library/more/") {
    return { ok: true, kind: "library-more" };
  }
  if (rest === "library" || rest === "library/") {
    return { ok: true, kind: "library" };
  }
  if (rest === "inbox" || rest === "inbox/") {
    return { ok: true, kind: "inbox" };
  }
  if (rest.startsWith("project/")) {
    const tail = rest.slice("project/".length);
    if (!tail) return { ok: false, reason: "missing project name" };
    const first = tail.split("/")[0] ?? "";
    if (!first) return { ok: false, reason: "missing project name" };
    return { ok: true, kind: "project", name: decodeURIComponent(first) };
  }
  if (rest.startsWith("visual/")) {
    const tail = rest.slice("visual/".length);
    if (!tail) return { ok: false, reason: "missing visual id" };
    const parts = tail.split("/");
    const id = parts[0];
    if (!id) return { ok: false, reason: "missing visual id" };
    if (parts.length === 1) return { ok: true, kind: "visual", id, version: null };
    const verPart = parts[1];
    if (!verPart || !verPart.startsWith("v")) {
      return { ok: false, reason: `expected /v{n}, got /${verPart}` };
    }
    const n = Number(verPart.slice(1));
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, reason: `invalid version number in URI: ${verPart}` };
    }
    return { ok: true, kind: "visual", id, version: n };
  }
  return { ok: false, reason: `unknown magpie:// path: ${rest}` };
}
