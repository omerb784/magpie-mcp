import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountGuideRoutes } from "./guide.js";

function buildApp(): Hono {
  const app = new Hono();
  mountGuideRoutes(app);
  return app;
}

describe("GET /guide", () => {
  it("returns the bundled user guide as text/html", async () => {
    const res = await buildApp().fetch(new Request("http://localhost/guide"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("Magpie");
    expect(body).toContain("User Guide");
  });

  it("rejects path traversal attempts under /guide/assets/", async () => {
    const res = await buildApp().fetch(
      new Request("http://localhost/guide/assets/..%2F..%2Fpackage.json")
    );
    expect(res.status).toBe(400);
  });

  it("404s a missing asset", async () => {
    const res = await buildApp().fetch(
      new Request("http://localhost/guide/assets/does-not-exist.png")
    );
    expect(res.status).toBe(404);
  });

  it("serves a real screenshot as image/png", async () => {
    const res = await buildApp().fetch(
      new Request("http://localhost/guide/assets/01-dashboard-light.png")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});
