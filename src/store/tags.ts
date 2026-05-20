import { getDb } from "./db.js";
import { newId } from "./ids.js";

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

export function tagColorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 70% 55%)`;
}

export function ensureTag(name: string): Tag {
  const existing = getDb()
    .prepare("SELECT * FROM tags WHERE name = ?")
    .get(name) as Tag | undefined;
  if (existing) return existing;
  const tag: Tag = { id: newId(), name, color: tagColorFor(name) };
  getDb()
    .prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)")
    .run(tag.id, tag.name, tag.color);
  return tag;
}

export function attachTag(visual_id: string, tag_id: string): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO visual_tags (visual_id, tag_id) VALUES (?, ?)"
    )
    .run(visual_id, tag_id);
}

export function setVisualTags(visual_id: string, names: string[]): void {
  const db = getDb();
  const tx = db.transaction((vid: string, list: string[]) => {
    db.prepare("DELETE FROM visual_tags WHERE visual_id = ?").run(vid);
    for (const name of list) {
      const t = ensureTag(name);
      attachTag(vid, t.id);
    }
  });
  tx(visual_id, names);
}

export function tagsForVisual(visual_id: string): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t
       JOIN visual_tags vt ON vt.tag_id = t.id
       WHERE vt.visual_id = ?
       ORDER BY t.name`
    )
    .all(visual_id) as Tag[];
}

export interface TagAggregate {
  name: string;
  color: string | null;
  count: number;
}

export function listTagAggregates(): TagAggregate[] {
  return getDb()
    .prepare(
      `SELECT t.name AS name,
              t.color AS color,
              COUNT(CASE WHEN v.archived_at IS NULL THEN vt.visual_id END) AS count
         FROM tags t
         LEFT JOIN visual_tags vt ON vt.tag_id = t.id
         LEFT JOIN visuals v       ON v.id = vt.visual_id
        GROUP BY t.id
        ORDER BY count DESC, t.name ASC`
    )
    .all() as TagAggregate[];
}
