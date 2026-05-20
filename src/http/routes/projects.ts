import { existsSync, readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import type { Hono } from "hono";
import { broadcast } from "../ws.js";
import { config } from "../../config.js";
import {
  archiveProject,
  DESCRIPTION_MAX,
  findArchivedByName,
  findByName,
  listArchivedProjects,
  listProjects,
  mergeProjects,
  renameProject,
  restoreProject,
  setProjectDescription,
} from "../../store/projects.js";
import { tagsForVisual } from "../../store/tags.js";
import { listForVisual } from "../../store/versions.js";
import {
  listArchivedVisualsForProject,
  listVisualsForProject,
} from "../../store/visuals.js";
import { extFor } from "../../store/blobs.js";
import { thumbPath } from "../../render/index.js";
import { slugify } from "../../util/slug.js";

export function mountProjectRoutes(app: Hono): void {
  app.get("/api/projects", (c) => {
    const includeArchived = c.req.query("archived") === "1";
    if (includeArchived) return c.json(listArchivedProjects());
    return c.json(listProjects());
  });

  app.get("/api/projects/:id/visuals", (c) => {
    const id = c.req.param("id");
    const archived = c.req.query("archived") === "1";
    const items = archived
      ? listArchivedVisualsForProject(id)
      : listVisualsForProject(id);
    return c.json(items);
  });

  app.get("/api/projects/:name", (c) => {
    const name = c.req.param("name");
    const p = findByName(name) ?? findArchivedByName(name);
    if (!p) return c.json({ error: "not_found" }, 404);
    return c.json(p);
  });

  app.patch("/api/projects/:name", async (c) => {
    const name = c.req.param("name");
    const body = (await c.req.json().catch(() => null)) as
      | { name?: string; description?: string | null }
      | null;
    if (!body) return c.json({ error: "bad_json" }, 400);

    const nameSupplied = body.name !== undefined;
    const descSupplied = body.description !== undefined;
    if (!nameSupplied && !descSupplied) {
      return c.json({ error: "nothing_to_update" }, 400);
    }
    if (nameSupplied && (typeof body.name !== "string" || body.name!.length === 0)) {
      return c.json({ error: "new name required" }, 400);
    }
    if (
      descSupplied &&
      body.description !== null &&
      (typeof body.description !== "string" || body.description.length > DESCRIPTION_MAX)
    ) {
      return c.json({ error: "bad_description" }, 400);
    }

    const current = findByName(name);
    if (!current) return c.json({ error: "not_found" }, 404);

    let finalName = name;
    if (nameSupplied && body.name !== name) {
      const result = renameProject(name, body.name!);
      if (!result.ok) return c.json({ error: result.reason }, 400);
      finalName = body.name!;
    }
    if (descSupplied) {
      setProjectDescription(current.id, body.description ?? null);
    }

    broadcast({ kind: "visual.updated", visual_id: "" });
    return c.json({ ok: true, name: finalName });
  });

  app.delete("/api/projects/:name", (c) => {
    const name = c.req.param("name");
    const ok = archiveProject(name);
    if (!ok) return c.json({ error: "not_found" }, 404);
    broadcast({ kind: "visual.updated", visual_id: "" });
    return c.json({ ok: true });
  });

  app.post("/api/projects/:name/restore", (c) => {
    const name = c.req.param("name");
    const ok = restoreProject(name);
    if (!ok) return c.json({ error: "cannot restore (missing or name conflict)" }, 400);
    broadcast({ kind: "visual.updated", visual_id: "" });
    return c.json({ ok: true });
  });

  app.post("/api/projects/:src/merge-into/:dst", (c) => {
    const src = c.req.param("src");
    const dst = c.req.param("dst");
    const result = mergeProjects(src, dst);
    if (!result.ok) return c.json({ error: result.reason }, 400);
    broadcast({ kind: "visual.updated", visual_id: "" });
    return c.json({ ok: true, ...result.result });
  });

  app.get("/api/projects/:name/export.zip", (c) => {
    const name = c.req.param("name");
    const project = findByName(name) ?? findArchivedByName(name);
    if (!project) return c.json({ error: "not_found" }, 404);

    const mode = c.req.query("versions") === "all" ? "all" : "current";
    const visuals = [
      ...listVisualsForProject(project.id),
      ...listArchivedVisualsForProject(project.id),
    ];

    const cap = config.maxContentBytes * 200;
    let totalBytes = 0;
    const files: Record<string, Uint8Array> = {};

    const projectSlug = slugify(project.name, project.id);

    const manifest = {
      project_name: project.name,
      project_id: project.id,
      created_at: project.created_at,
      visual_count: visuals.length,
      generated_at: new Date().toISOString(),
      versions_mode: mode,
    };
    files[`${projectSlug}/manifest.json`] = strToU8(JSON.stringify(manifest, null, 2));

    for (const v of visuals) {
      const versions = listForVisual(v.id);
      const inScope =
        mode === "all" ? versions : versions.filter((ver) => ver.version_num === v.current_ver);

      const visualSlug = slugify(v.title, v.id);
      const dir = `${projectSlug}/${v.id}__${visualSlug}`;

      const includedVersions: number[] = [];
      for (const ver of inScope) {
        if (existsSync(ver.content_path)) {
          const buf = readFileSync(ver.content_path);
          totalBytes += buf.byteLength;
          if (totalBytes > cap) {
            return c.json(
              { error: "project_too_large", message: `exceeds ${cap} bytes; use per-visual download instead` },
              413
            );
          }
          files[`${dir}/v${ver.version_num}.${extFor(v.type)}`] = new Uint8Array(buf);
          includedVersions.push(ver.version_num);

          const tp = thumbPath(v.id, ver.version_num);
          if (existsSync(tp) && ver.render_status === "ok") {
            const thumb = readFileSync(tp);
            totalBytes += thumb.byteLength;
            if (totalBytes > cap) {
              return c.json({ error: "project_too_large" }, 413);
            }
            files[`${dir}/v${ver.version_num}.png`] = new Uint8Array(thumb);
          }
        }
      }

      const tags = tagsForVisual(v.id);
      const meta = {
        id: v.id,
        title: v.title,
        type: v.type,
        source: v.source,
        current_ver: v.current_ver,
        starred: Boolean(v.starred),
        archived_at: v.archived_at,
        tags: tags.map((t) => t.name),
        included_versions: includedVersions,
      };
      files[`${dir}/meta.json`] = strToU8(JSON.stringify(meta, null, 2));
    }

    const zipped = zipSync(files, { level: 6 });
    const date = new Date().toISOString().slice(0, 10);
    const filename = `magpie__${projectSlug}__${date}.zip`;
    return new Response(new Uint8Array(zipped), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
