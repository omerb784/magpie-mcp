import { existsSync, mkdirSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../../store/db.js";
import { createTemplate } from "../../store/send-templates.js";
import { mountTemplatesShellRoutes } from "./templates-shell.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function buildApp(): Hono {
  const app = new Hono();
  mountTemplatesShellRoutes(app);
  return app;
}

describe("/templates server shell", () => {
  it("GET /templates returns the list-mode shell HTML", async () => {
    const app = buildApp();
    const res = await app.request("/templates");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('<script src="/assets/templates.iife.js" defer></script>');
    // No id passed when listing — boot script receives `id: null`.
    expect(html).toContain("id: null");
    expect(html).toContain("templates — Magpie");
  });

  it("honors magpie_theme cookie when set on /templates", async () => {
    const app = buildApp();
    const res = await app.request("/templates", {
      headers: { cookie: "magpie_theme=dark" },
    });
    const html = await res.text();
    expect(html).toContain('data-theme="dark"');
  });

  it("GET /templates/:id 404s for unknown id", async () => {
    const app = buildApp();
    const res = await app.request("/templates/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("GET /templates/:id returns shell with id baked in for an existing template", async () => {
    const create = createTemplate({
      name: "MyTpl",
      body: "{{x}}",
      var_names: ["x"],
    });
    if (!create.ok) throw new Error("setup");
    const app = buildApp();
    const res = await app.request(`/templates/${create.template.id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(JSON.stringify(create.template.id));
    expect(html).toContain("MyTpl — templates — Magpie");
  });

  it("escapes the template name in the document <title>", async () => {
    const create = createTemplate({
      name: "<script>x</script>",
      body: "{{x}}",
      var_names: ["x"],
    });
    if (!create.ok) throw new Error("setup");
    const app = buildApp();
    const res = await app.request(`/templates/${create.template.id}`);
    const html = await res.text();
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("returns Content-Type text/html on both shell variants", async () => {
    const app = buildApp();
    const list = await app.request("/templates");
    expect(list.headers.get("content-type")).toMatch(/text\/html/);
    const create = createTemplate({
      name: "x",
      body: "{{x}}",
      var_names: ["x"],
    });
    if (!create.ok) throw new Error("setup");
    const detail = await app.request(`/templates/${create.template.id}`);
    expect(detail.headers.get("content-type")).toMatch(/text\/html/);
  });
});
