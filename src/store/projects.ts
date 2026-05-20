import { getDb } from "./db.js";
import { newId, nowIso } from "./ids.js";

export type ProjectType = "mockup" | "diagram" | "mixed";

export const DESCRIPTION_MAX = 2000;

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  description: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ProjectSummary extends Project {
  visual_count: number;
  last_activity: string;
}

export function getProjectById(id: string): Project | null {
  const row = getDb()
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as Project | undefined;
  return row ?? null;
}

export function findByName(name: string): Project | null {
  const row = getDb()
    .prepare("SELECT * FROM projects WHERE name = ? AND archived_at IS NULL")
    .get(name) as Project | undefined;
  return row ?? null;
}

export function createProject(
  name: string,
  type: ProjectType,
  description: string | null = null
): Project {
  const existing = findByName(name);
  if (existing) return existing;
  const now = nowIso();
  const project: Project = {
    id: newId(),
    name,
    type,
    description,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
  getDb()
    .prepare(
      "INSERT INTO projects (id, name, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(
      project.id,
      project.name,
      project.type,
      project.description,
      project.created_at,
      project.updated_at
    );
  return project;
}

export function setProjectDescription(id: string, description: string | null): void {
  getDb()
    .prepare("UPDATE projects SET description = ?, updated_at = ? WHERE id = ?")
    .run(description, nowIso(), id);
}

export function archiveProject(name: string): boolean {
  const existing = findByName(name);
  if (!existing) return false;
  const now = nowIso();
  getDb()
    .prepare("UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, existing.id);
  return true;
}

export function findArchivedByName(name: string): Project | null {
  const row = getDb()
    .prepare("SELECT * FROM projects WHERE name = ? AND archived_at IS NOT NULL")
    .get(name) as Project | undefined;
  return row ?? null;
}

export function restoreProject(name: string): boolean {
  const existing = findArchivedByName(name);
  if (!existing) return false;
  const conflict = findByName(name);
  if (conflict) return false;
  getDb()
    .prepare("UPDATE projects SET archived_at = NULL, updated_at = ? WHERE id = ?")
    .run(nowIso(), existing.id);
  return true;
}

export function listArchivedProjects(): ProjectSummary[] {
  return getDb()
    .prepare(
      `SELECT p.*,
              COALESCE(COUNT(v.id), 0) AS visual_count,
              COALESCE(MAX(v.updated_at), p.updated_at) AS last_activity
       FROM projects p
       LEFT JOIN visuals v ON v.project_id = p.id
       WHERE p.archived_at IS NOT NULL
       GROUP BY p.id
       ORDER BY p.archived_at DESC`
    )
    .all() as ProjectSummary[];
}

export function renameProject(oldName: string, newName: string): { ok: true } | { ok: false; reason: string } {
  if (oldName === newName) return { ok: false, reason: "old_name and new_name are identical" };
  const existing = findByName(oldName);
  if (!existing) return { ok: false, reason: `project "${oldName}" not found` };
  const conflict = findByName(newName);
  if (conflict) return { ok: false, reason: `project "${newName}" already exists` };
  getDb()
    .prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
    .run(newName, nowIso(), existing.id);
  return { ok: true };
}

export interface MergeResult {
  moved: number;
  src_archived: boolean;
}

export function mergeProjects(srcName: string, dstName: string): { ok: true; result: MergeResult } | { ok: false; reason: string } {
  if (srcName === dstName) return { ok: false, reason: "src and dst are the same project" };
  const src = findByName(srcName);
  if (!src) return { ok: false, reason: `source project "${srcName}" not found` };
  const dst = findByName(dstName);
  if (!dst) return { ok: false, reason: `destination project "${dstName}" not found` };

  const db = getDb();
  let moved = 0;
  const tx = db.transaction(() => {
    const res = db
      .prepare("UPDATE visuals SET project_id = ?, updated_at = ? WHERE project_id = ?")
      .run(dst.id, nowIso(), src.id);
    moved = res.changes;
    db.prepare("UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(nowIso(), nowIso(), src.id);
  });
  tx();
  return { ok: true, result: { moved, src_archived: true } };
}

export function listProjects(): ProjectSummary[] {
  return getDb()
    .prepare(
      `SELECT p.*,
              COALESCE(COUNT(v.id), 0) AS visual_count,
              COALESCE(MAX(v.updated_at), p.updated_at) AS last_activity
       FROM projects p
       LEFT JOIN visuals v ON v.project_id = p.id AND v.archived_at IS NULL
       WHERE p.archived_at IS NULL
       GROUP BY p.id
       ORDER BY last_activity DESC`
    )
    .all() as ProjectSummary[];
}
