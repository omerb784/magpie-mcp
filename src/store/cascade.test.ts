import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./db.js";
import { createProject } from "./projects.js";
import { createVisual } from "./visuals.js";
import { appendVersion, nextVersionNum } from "./versions.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function seedTagOnVisual(visualId: string, tagName: string) {
  const db = getDb();
  const tagRow = db.prepare("SELECT id FROM tags WHERE name = ?").get(tagName) as
    | { id: string }
    | undefined;
  let tagId = tagRow?.id;
  if (!tagId) {
    tagId = `tag-${tagName}`;
    db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, NULL)").run(tagId, tagName);
  }
  db.prepare("INSERT OR IGNORE INTO visual_tags (visual_id, tag_id) VALUES (?, ?)").run(
    visualId,
    tagId
  );
}

function insertScopedTemplate(args: {
  id: string;
  scope_project_id: string | null;
  scope_visual_id: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO send_templates
        (id, name, body, var_names, is_builtin, sort_order, created_at, var_schema, current_version_num, scope_project_id, scope_visual_id)
       VALUES (?, ?, ?, '[]', 0, 0, ?, NULL, 1, ?, ?)`
    )
    .run(
      args.id,
      `scoped-${args.id}`,
      "test body",
      "2026-05-14T00:00:00Z",
      args.scope_project_id,
      args.scope_visual_id
    );
}

function insertInboxRow(args: {
  id: string;
  visual_id: string | null;
  template_id: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO agent_inbox
        (id, visual_id, template_id, prompt_body, vars, created_at, consumed_at)
       VALUES (?, ?, ?, ?, NULL, ?, NULL)`
    )
    .run(args.id, args.visual_id, args.template_id, "compose body", "2026-05-14T00:00:00Z");
}

describe("D2 · FK cascade integrity", () => {
  it("delete project cascades to visuals + versions + visual_tags", () => {
    const project = createProject("cascade-proj", "mockup");
    const v1 = createVisual({
      project_id: project.id,
      title: "v1",
      type: "html",
      source: null,
    });
    const v2 = createVisual({
      project_id: project.id,
      title: "v2",
      type: "mermaid",
      source: null,
    });
    appendVersion({
      visual_id: v1.id,
      version_num: nextVersionNum(v1.id),
      content_path: "/tmp/x",
      message: null,
    });
    appendVersion({
      visual_id: v2.id,
      version_num: nextVersionNum(v2.id),
      content_path: "/tmp/y",
      message: null,
    });
    seedTagOnVisual(v1.id, "tag-a");
    seedTagOnVisual(v2.id, "tag-b");

    const db = getDb();
    db.prepare("DELETE FROM projects WHERE id = ?").run(project.id);

    expect((db.prepare("SELECT COUNT(*) c FROM visuals WHERE project_id = ?").get(project.id) as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM versions WHERE visual_id IN (?, ?)").get(v1.id, v2.id) as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM visual_tags WHERE visual_id IN (?, ?)").get(v1.id, v2.id) as { c: number }).c).toBe(0);
    // Tags themselves survive (they're a shared table).
    expect((db.prepare("SELECT COUNT(*) c FROM tags WHERE name IN ('tag-a','tag-b')").get() as { c: number }).c).toBe(2);
  });

  it("delete visual cascades to versions + visual_tags", () => {
    const project = createProject("v-cascade-proj", "mockup");
    const v1 = createVisual({
      project_id: project.id,
      title: "lone-visual",
      type: "html",
      source: null,
    });
    appendVersion({
      visual_id: v1.id,
      version_num: nextVersionNum(v1.id),
      content_path: "/tmp/x",
      message: null,
    });
    seedTagOnVisual(v1.id, "shared-tag");

    const otherVisual = createVisual({
      project_id: project.id,
      title: "kept",
      type: "html",
      source: null,
    });
    seedTagOnVisual(otherVisual.id, "shared-tag");

    const db = getDb();
    db.prepare("DELETE FROM visuals WHERE id = ?").run(v1.id);

    expect((db.prepare("SELECT COUNT(*) c FROM versions WHERE visual_id = ?").get(v1.id) as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM visual_tags WHERE visual_id = ?").get(v1.id) as { c: number }).c).toBe(0);
    // Sibling visual untouched.
    expect((db.prepare("SELECT COUNT(*) c FROM visual_tags WHERE visual_id = ?").get(otherVisual.id) as { c: number }).c).toBe(1);
    // Project survives.
    expect((db.prepare("SELECT COUNT(*) c FROM projects WHERE id = ?").get(project.id) as { c: number }).c).toBe(1);
  });

  it("R15 · scoped send_templates cascade with parent project / visual", () => {
    const project = createProject("scope-proj", "mockup");
    const visual = createVisual({
      project_id: project.id,
      title: "scope-visual",
      type: "html",
      source: null,
    });
    insertScopedTemplate({
      id: "tpl-proj-scope",
      scope_project_id: project.id,
      scope_visual_id: null,
    });
    insertScopedTemplate({
      id: "tpl-visual-scope",
      scope_project_id: null,
      scope_visual_id: visual.id,
    });
    insertScopedTemplate({
      id: "tpl-global",
      scope_project_id: null,
      scope_visual_id: null,
    });

    const db = getDb();
    db.prepare("DELETE FROM visuals WHERE id = ?").run(visual.id);

    expect((db.prepare("SELECT COUNT(*) c FROM send_templates WHERE id = ?").get("tpl-visual-scope") as { c: number }).c).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM send_templates WHERE id = ?").get("tpl-proj-scope") as { c: number }).c).toBe(1);

    db.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
    expect((db.prepare("SELECT COUNT(*) c FROM send_templates WHERE id = ?").get("tpl-proj-scope") as { c: number }).c).toBe(0);
    // Global template survives both deletions.
    expect((db.prepare("SELECT COUNT(*) c FROM send_templates WHERE id = ?").get("tpl-global") as { c: number }).c).toBe(1);
  });

  it("R16 · agent_inbox.visual_id sets NULL on visual delete (no cascade)", () => {
    const project = createProject("inbox-proj", "mockup");
    const v = createVisual({
      project_id: project.id,
      title: "inbox-target",
      type: "html",
      source: null,
    });
    insertInboxRow({ id: "inbox-1", visual_id: v.id, template_id: null });
    insertInboxRow({ id: "inbox-2", visual_id: v.id, template_id: null });

    const db = getDb();
    db.prepare("DELETE FROM visuals WHERE id = ?").run(v.id);

    // Inbox rows survive; visual_id is nulled.
    const rows = db
      .prepare("SELECT id, visual_id FROM agent_inbox WHERE id IN ('inbox-1','inbox-2') ORDER BY id")
      .all() as { id: string; visual_id: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].visual_id).toBeNull();
    expect(rows[1].visual_id).toBeNull();
  });

  it("archive project does NOT cascade — visuals + versions + scoped templates survive", () => {
    const project = createProject("archive-proj", "mockup");
    const v = createVisual({
      project_id: project.id,
      title: "lives",
      type: "html",
      source: null,
    });
    appendVersion({
      visual_id: v.id,
      version_num: nextVersionNum(v.id),
      content_path: "/tmp/z",
      message: null,
    });
    insertScopedTemplate({
      id: "tpl-archive-survive",
      scope_project_id: project.id,
      scope_visual_id: null,
    });

    const db = getDb();
    db.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").run("2026-05-14T00:00:00Z", project.id);

    expect((db.prepare("SELECT COUNT(*) c FROM visuals WHERE id = ?").get(v.id) as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT COUNT(*) c FROM versions WHERE visual_id = ?").get(v.id) as { c: number }).c).toBeGreaterThan(0);
    expect((db.prepare("SELECT COUNT(*) c FROM send_templates WHERE id = ?").get("tpl-archive-survive") as { c: number }).c).toBe(1);
  });

  it("R16 finding · send_template_versions.examples JSON refs become orphans (app-layer concern)", () => {
    // R16 stores visual references as JSON inside send_template_versions.examples — not a real FK.
    // This pins the behavior: deleting the referenced visual leaves the JSON string intact in
    // history rows. The dashboard + tools must dereference + check existence at read time.
    // Migration 012 already wipes legacy data; this test guards future regressions where a real
    // FK might be added unintentionally.
    const project = createProject("r16-proj", "mockup");
    const v = createVisual({
      project_id: project.id,
      title: "ref-target",
      type: "html",
      source: null,
    });
    const examplesJson = JSON.stringify([
      { name: "ref1", visual_id: v.id, visual_version: 1 },
    ]);

    const db = getDb();
    db.prepare(
      `INSERT INTO send_templates
        (id, name, body, var_names, is_builtin, sort_order, created_at, current_version_num)
       VALUES ('tpl-r16', 'tpl-r16', 'body', '[]', 0, 0, ?, 1)`
    ).run("2026-05-14T00:00:00Z");

    db.prepare(
      `INSERT INTO send_template_versions
        (id, template_id, version_num, body, var_schema, examples, created_at)
       VALUES ('tpl-r16-v1', 'tpl-r16', 1, 'body', NULL, ?, ?)`
    ).run(examplesJson, "2026-05-14T00:00:00Z");

    db.prepare("DELETE FROM visuals WHERE id = ?").run(v.id);

    const row = db
      .prepare("SELECT examples FROM send_template_versions WHERE id = 'tpl-r16-v1'")
      .get() as { examples: string };
    expect(row.examples).toBe(examplesJson);
    const parsed = JSON.parse(row.examples) as { visual_id: string }[];
    expect(parsed[0].visual_id).toBe(v.id);
  });
});
