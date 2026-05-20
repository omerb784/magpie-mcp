import { getDb } from "./db.js";
import { newId, nowIso } from "./ids.js";

export const PROMPT_BODY_MAX = 8000;

export type InboxStatus = "pending" | "consumed" | "all";

export interface InboxEntry {
  id: string;
  visual_id: string | null;
  template_id: string | null;
  template_version_num: number | null;
  prompt_body: string;
  vars: Record<string, string> | null;
  created_at: string;
  consumed_at: string | null;
}

interface InboxRow {
  id: string;
  visual_id: string | null;
  template_id: string | null;
  template_version_num: number | null;
  prompt_body: string;
  vars: string | null;
  created_at: string;
  consumed_at: string | null;
}

function rowToEntry(row: InboxRow): InboxEntry {
  return {
    id: row.id,
    visual_id: row.visual_id,
    template_id: row.template_id,
    template_version_num: row.template_version_num,
    prompt_body: row.prompt_body,
    vars: row.vars ? (JSON.parse(row.vars) as Record<string, string>) : null,
    created_at: row.created_at,
    consumed_at: row.consumed_at,
  };
}

export function insertInbox(args: {
  visual_id?: string | null;
  template_id?: string | null;
  template_version_num?: number | null;
  prompt_body: string;
  vars?: Record<string, string> | null;
}): InboxEntry {
  const entry: InboxEntry = {
    id: newId(),
    visual_id: args.visual_id ?? null,
    template_id: args.template_id ?? null,
    template_version_num: args.template_version_num ?? null,
    prompt_body: args.prompt_body,
    vars: args.vars ?? null,
    created_at: nowIso(),
    consumed_at: null,
  };
  getDb()
    .prepare(
      `INSERT INTO agent_inbox
        (id, visual_id, template_id, template_version_num, prompt_body, vars, created_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      entry.id,
      entry.visual_id,
      entry.template_id,
      entry.template_version_num,
      entry.prompt_body,
      entry.vars ? JSON.stringify(entry.vars) : null,
      entry.created_at
    );
  return entry;
}

export function getInbox(id: string): InboxEntry | null {
  const row = getDb().prepare("SELECT * FROM agent_inbox WHERE id = ?").get(id) as
    | InboxRow
    | undefined;
  return row ? rowToEntry(row) : null;
}

export function listInbox(args: { status?: InboxStatus; limit?: number } = {}): InboxEntry[] {
  const status = args.status ?? "pending";
  const limit = args.limit ?? 200;
  let where = "";
  if (status === "pending") where = "WHERE consumed_at IS NULL";
  else if (status === "consumed") where = "WHERE consumed_at IS NOT NULL";
  const rows = getDb()
    .prepare(
      `SELECT * FROM agent_inbox ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(limit) as InboxRow[];
  return rows.map(rowToEntry);
}

export function markConsumed(ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const now = nowIso();
  const result = getDb()
    .prepare(
      `UPDATE agent_inbox
       SET consumed_at = ?
       WHERE id IN (${placeholders}) AND consumed_at IS NULL`
    )
    .run(now, ...ids);
  return result.changes;
}

export function deleteInbox(id: string): boolean {
  const result = getDb().prepare("DELETE FROM agent_inbox WHERE id = ?").run(id);
  return result.changes > 0;
}

export function countInbox(status: InboxStatus = "pending"): number {
  let where = "";
  if (status === "pending") where = "WHERE consumed_at IS NULL";
  else if (status === "consumed") where = "WHERE consumed_at IS NOT NULL";
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM agent_inbox ${where}`)
    .get() as { n: number };
  return row.n;
}
