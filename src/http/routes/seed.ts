import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { enqueueRender } from "../../render/index.js";
import { writeBlob } from "../../store/blobs.js";
import { createProject, findByName } from "../../store/projects.js";
import { appendVersion } from "../../store/versions.js";
import { createVisual, VISUAL_TYPE_VALUES, type VisualType } from "../../store/visuals.js";
import { broadcast } from "../ws.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_NAME = "atlas";

interface ExampleEntry {
  type: VisualType;
  title: string;
  body: string;
}

interface ExampleBundle {
  entries: ExampleEntry[];
}

function bundlePath(): string {
  const candidates = [
    join(__dirname, "..", "..", "..", "seed", "example-bundle.json"),
    join(__dirname, "..", "..", "seed", "example-bundle.json"),
    join(process.cwd(), "seed", "example-bundle.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]!;
}

function loadBundle(): ExampleBundle | { error: string } {
  const path = bundlePath();
  if (!existsSync(path)) return { error: `seed bundle missing at ${path}` };
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { entries?: unknown }).entries)) {
      return { error: "seed bundle malformed: missing entries[]" };
    }
    const entries = (parsed as { entries: unknown[] }).entries;
    const validated: ExampleEntry[] = [];
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") return { error: "seed entry not an object" };
      const e = raw as Record<string, unknown>;
      if (typeof e.type !== "string" || !VISUAL_TYPE_VALUES.includes(e.type as VisualType)) {
        return { error: `seed entry has bad type: ${String(e.type)}` };
      }
      if (typeof e.title !== "string" || e.title.length === 0) {
        return { error: "seed entry missing title" };
      }
      if (typeof e.body !== "string" || e.body.length === 0) {
        return { error: "seed entry missing body" };
      }
      validated.push({ type: e.type as VisualType, title: e.title, body: e.body });
    }
    return { entries: validated };
  } catch (err) {
    return { error: `seed bundle parse failed: ${(err as Error).message}` };
  }
}

export function mountSeedRoutes(app: Hono): void {
  app.post("/api/seed/load-example", (c) => {
    const existing = findByName(PROJECT_NAME);
    if (existing) {
      return c.json(
        { existing: true, projectId: existing.id, msg: "Example project already loaded" },
        409
      );
    }

    const bundle = loadBundle();
    if ("error" in bundle) {
      return c.json({ error: bundle.error }, 500);
    }

    const project = createProject(PROJECT_NAME, "mixed");
    const visualIds: string[] = [];

    for (const entry of bundle.entries) {
      const visual = createVisual({
        project_id: project.id,
        title: entry.title,
        type: entry.type,
        source: null,
        description: null,
      });
      const contentPath = writeBlob({
        visual_id: visual.id,
        version_num: 1,
        type: entry.type,
        content: entry.body,
      });
      const version = appendVersion({
        visual_id: visual.id,
        version_num: 1,
        content_path: contentPath,
        message: null,
      });
      enqueueRender({
        visual_id: visual.id,
        version_id: version.id,
        version_num: 1,
        type: entry.type,
        content_path: contentPath,
      });
      visualIds.push(visual.id);
    }

    broadcast({ kind: "visual.updated", visual_id: "" });

    return c.json({ created: true, projectId: project.id, visualIds }, 200);
  });
}
