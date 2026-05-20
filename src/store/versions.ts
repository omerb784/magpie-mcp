import { getDb } from "./db.js";
import { newId, nowIso } from "./ids.js";

export type RenderStatus = "pending" | "ok" | "warn" | "failed";

export interface Version {
  id: string;
  visual_id: string;
  version_num: number;
  content_path: string;
  thumb_path: string | null;
  render_status: RenderStatus;
  render_error: string | null;
  message: string | null;
  description: string | null;
  created_at: string;
}

export function listForVisual(visual_id: string): Version[] {
  return getDb()
    .prepare("SELECT * FROM versions WHERE visual_id = ? ORDER BY version_num ASC")
    .all(visual_id) as Version[];
}

export function nextVersionNum(visual_id: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(version_num), 0) AS n FROM versions WHERE visual_id = ?")
    .get(visual_id) as { n: number };
  return row.n + 1;
}

export function appendVersion(args: {
  visual_id: string;
  version_num: number;
  content_path: string;
  message: string | null;
  description?: string | null;
}): Version {
  const v: Version = {
    id: newId(),
    visual_id: args.visual_id,
    version_num: args.version_num,
    content_path: args.content_path,
    thumb_path: null,
    render_status: "pending",
    render_error: null,
    message: args.message,
    description: args.description ?? null,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO versions
        (id, visual_id, version_num, content_path, thumb_path, render_status, render_error, message, description, created_at)
       VALUES (?, ?, ?, ?, NULL, 'pending', NULL, ?, ?, ?)`
    )
    .run(v.id, v.visual_id, v.version_num, v.content_path, v.message, v.description, v.created_at);
  return v;
}

export function setRenderStatus(args: {
  version_id: string;
  status: RenderStatus;
  thumb_path: string | null;
  error: string | null;
}): void {
  getDb()
    .prepare(
      "UPDATE versions SET render_status = ?, thumb_path = ?, render_error = ? WHERE id = ?"
    )
    .run(args.status, args.thumb_path, args.error, args.version_id);
}

export function getRenderState(version_id: string): { status: RenderStatus; error: string | null } | null {
  const row = getDb()
    .prepare("SELECT render_status, render_error FROM versions WHERE id = ?")
    .get(version_id) as { render_status: RenderStatus; render_error: string | null } | undefined;
  if (!row) return null;
  return { status: row.render_status, error: row.render_error };
}

export async function waitForRender(
  version_id: string,
  timeoutMs: number,
  pollMs = 100
): Promise<{ status: RenderStatus; error: string | null }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = getRenderState(version_id);
    if (state && state.status !== "pending") return state;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return getRenderState(version_id) ?? { status: "pending", error: null };
}
