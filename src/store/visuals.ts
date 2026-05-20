import { getDb } from "./db.js";
import { newId, nowIso } from "./ids.js";

export const VISUAL_TYPE_VALUES = [
  "html",
  "mermaid",
  "svg",
  "markdown",
  "dot",
  "vega-lite",
  "d2",
] as const;
export type VisualType = (typeof VISUAL_TYPE_VALUES)[number];
export type Source =
  | "stitch"
  | "figma"
  | "mermaid-chart"
  | "svgmaker"
  | "icons8"
  | "claude"
  | "manual";

export interface Visual {
  id: string;
  project_id: string;
  title: string;
  type: VisualType;
  source: Source | null;
  description: string | null;
  current_ver: number;
  starred: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export function getVisual(id: string): Visual | null {
  const row = getDb().prepare("SELECT * FROM visuals WHERE id = ?").get(id) as
    | Visual
    | undefined;
  return row ?? null;
}

export function createVisual(args: {
  project_id: string;
  title: string;
  type: VisualType;
  source: Source | null;
  description?: string | null;
}): Visual {
  const now = nowIso();
  const visual: Visual = {
    id: newId(),
    project_id: args.project_id,
    title: args.title,
    type: args.type,
    source: args.source,
    description: args.description ?? null,
    current_ver: 1,
    starred: 0,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
  getDb()
    .prepare(
      `INSERT INTO visuals
        (id, project_id, title, type, source, description, current_ver, starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
    )
    .run(
      visual.id,
      visual.project_id,
      visual.title,
      visual.type,
      visual.source,
      visual.description,
      visual.created_at,
      visual.updated_at
    );
  return visual;
}

export function setVisualDescription(visual_id: string, description: string | null): void {
  getDb()
    .prepare("UPDATE visuals SET description = ?, updated_at = ? WHERE id = ?")
    .run(description, nowIso(), visual_id);
}

export function bumpCurrentVersion(visual_id: string, version_num: number): void {
  getDb()
    .prepare("UPDATE visuals SET current_ver = ?, updated_at = ? WHERE id = ?")
    .run(version_num, nowIso(), visual_id);
}

export function updateVisualMeta(args: {
  visual_id: string;
  title?: string;
  starred?: boolean;
}): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (args.title !== undefined) {
    sets.push("title = ?");
    params.push(args.title);
  }
  if (args.starred !== undefined) {
    sets.push("starred = ?");
    params.push(args.starred ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  params.push(nowIso());
  params.push(args.visual_id);
  getDb()
    .prepare(`UPDATE visuals SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function archiveVisual(visual_id: string): void {
  getDb()
    .prepare("UPDATE visuals SET archived_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), visual_id);
}

export function restoreVisual(visual_id: string): void {
  getDb()
    .prepare("UPDATE visuals SET archived_at = NULL, updated_at = ? WHERE id = ?")
    .run(nowIso(), visual_id);
}

export interface VisualGridItem extends Visual {
  current_render_status: "pending" | "ok" | "warn" | "failed" | null;
  thumb_version: number | null;
  project_name: string;
  tag_names: string;
}

const GRID_COLUMNS = `v.*,
       p.name AS project_name,
       cv.render_status AS current_render_status,
       cv.version_num   AS thumb_version,
       COALESCE(
         (SELECT GROUP_CONCAT(t.name, ',')
            FROM visual_tags vt
            JOIN tags t ON t.id = vt.tag_id
           WHERE vt.visual_id = v.id),
         ''
       ) AS tag_names`;

export function getVisualGridItem(id: string): VisualGridItem | null {
  const row = getDb()
    .prepare(
      `SELECT ${GRID_COLUMNS}
       FROM visuals v
       JOIN projects p ON p.id = v.project_id
       LEFT JOIN versions cv
              ON cv.visual_id = v.id
             AND cv.version_num = v.current_ver
       WHERE v.id = ?`
    )
    .get(id) as VisualGridItem | undefined;
  return row ?? null;
}

export interface SiblingVisual {
  id: string;
  title: string;
  type: VisualType;
  current_ver: number;
}

export function listSiblingsInProject(project_id: string): SiblingVisual[] {
  return getDb()
    .prepare(
      `SELECT id, title, type, current_ver
         FROM visuals
        WHERE project_id = ?
          AND archived_at IS NULL
        ORDER BY updated_at DESC`
    )
    .all(project_id) as SiblingVisual[];
}

export function listVisualsForProject(project_id: string): VisualGridItem[] {
  return getDb()
    .prepare(
      `SELECT ${GRID_COLUMNS}
       FROM visuals v
       JOIN projects p ON p.id = v.project_id
       LEFT JOIN versions cv
              ON cv.visual_id = v.id
             AND cv.version_num = v.current_ver
       WHERE v.project_id = ?
         AND v.archived_at IS NULL
       ORDER BY v.updated_at DESC`
    )
    .all(project_id) as VisualGridItem[];
}

export function listArchivedVisualsForProject(project_id: string): VisualGridItem[] {
  return getDb()
    .prepare(
      `SELECT ${GRID_COLUMNS}
       FROM visuals v
       JOIN projects p ON p.id = v.project_id
       LEFT JOIN versions cv
              ON cv.visual_id = v.id
             AND cv.version_num = v.current_ver
       WHERE v.project_id = ?
         AND v.archived_at IS NOT NULL
       ORDER BY v.archived_at DESC`
    )
    .all(project_id) as VisualGridItem[];
}

export function listAllVisuals(): VisualGridItem[] {
  return getDb()
    .prepare(
      `SELECT ${GRID_COLUMNS}
       FROM visuals v
       JOIN projects p ON p.id = v.project_id
       LEFT JOIN versions cv
              ON cv.visual_id = v.id
             AND cv.version_num = v.current_ver
       WHERE v.archived_at IS NULL
       ORDER BY v.updated_at DESC`
    )
    .all() as VisualGridItem[];
}

export function listStarred(): VisualGridItem[] {
  return getDb()
    .prepare(
      `SELECT ${GRID_COLUMNS}
       FROM visuals v
       JOIN projects p ON p.id = v.project_id
       LEFT JOIN versions cv
              ON cv.visual_id = v.id
             AND cv.version_num = v.current_ver
       WHERE v.archived_at IS NULL
         AND v.starred = 1
       ORDER BY v.updated_at DESC`
    )
    .all() as VisualGridItem[];
}

export interface LibraryCounts {
  all: number;
  starred: number;
  archived: number;
}

export function getLibraryCounts(): LibraryCounts {
  const row = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS all_count,
         SUM(CASE WHEN archived_at IS NULL AND starred = 1 THEN 1 ELSE 0 END) AS starred,
         SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
       FROM visuals`
    )
    .get() as { all_count: number | null; starred: number | null; archived: number | null };
  return {
    all: Number(row.all_count ?? 0),
    starred: Number(row.starred ?? 0),
    archived: Number(row.archived ?? 0),
  };
}

export interface SearchVisualsArgs {
  query?: string;
  match_description?: boolean;
  project?: string;
  tag?: string;
  tags?: string[];
  type?: VisualType;
  source?: Source;
  starred?: boolean;
}

export interface SearchVisualHit extends Visual {
  project_name: string;
  tag_names: string;
  current_render_status: "pending" | "ok" | "warn" | "failed" | null;
  thumb_version: number | null;
}

export function buildSearchVisualsSql(args: SearchVisualsArgs): {
  sql: string;
  params: unknown[];
} {
  const wheres: string[] = ["v.archived_at IS NULL"];
  const params: unknown[] = [];

  if (args.query && args.query.trim().length > 0) {
    const needle = `%${args.query.trim()}%`;
    if (args.match_description) {
      wheres.push("(v.title LIKE ? OR v.description LIKE ?)");
      params.push(needle, needle);
    } else {
      wheres.push("v.title LIKE ?");
      params.push(needle);
    }
  }
  if (args.project) {
    wheres.push("p.name = ?");
    wheres.push("p.archived_at IS NULL");
    params.push(args.project);
  }
  if (args.type) {
    wheres.push("v.type = ?");
    params.push(args.type);
  }
  if (args.source) {
    wheres.push("v.source = ?");
    params.push(args.source);
  }
  if (args.starred) {
    wheres.push("v.starred = 1");
  }
  const tagList = (args.tags && args.tags.length > 0
    ? args.tags
    : args.tag
    ? [args.tag]
    : []
  ).filter((t) => typeof t === "string" && t.length > 0);
  for (const name of tagList) {
    wheres.push(
      "EXISTS (SELECT 1 FROM visual_tags vt JOIN tags t ON t.id = vt.tag_id WHERE vt.visual_id = v.id AND t.name = ?)"
    );
    params.push(name);
  }

  const sql = `
    SELECT v.*,
           p.name AS project_name,
           cv.render_status AS current_render_status,
           cv.version_num   AS thumb_version,
           COALESCE(
             (SELECT GROUP_CONCAT(t.name, ',')
                FROM visual_tags vt
                JOIN tags t ON t.id = vt.tag_id
               WHERE vt.visual_id = v.id),
             ''
           ) AS tag_names
    FROM visuals v
    JOIN projects p ON p.id = v.project_id
    LEFT JOIN versions cv ON cv.visual_id = v.id AND cv.version_num = v.current_ver
    WHERE ${wheres.join(" AND ")}
    ORDER BY v.updated_at DESC
    LIMIT 200
  `;
  return { sql, params };
}

export function searchVisuals(args: SearchVisualsArgs): SearchVisualHit[] {
  const { sql, params } = buildSearchVisualsSql(args);
  return getDb().prepare(sql).all(...params) as SearchVisualHit[];
}
