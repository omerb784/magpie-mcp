import { existsSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { mountCanonicalInfoRoutes } from "./canonical-info.js";

const HOME = process.env.MAGPIE_HOME!;
const LOCK = join(HOME, "magpie.lock");

function buildApp(): Hono {
  const app = new Hono();
  mountCanonicalInfoRoutes(app);
  return app;
}

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
});

describe("GET /api/canonical-info", () => {
  it("returns 200 with discovery file fields when canonical is live", async () => {
    writeFileSync(
      LOCK,
      JSON.stringify({
        pid: 4242,
        ipcPath: "\\\\.\\pipe\\magpie-abcdef012345",
        httpPort: 3738,
        startedAt: 1715600000000,
      }),
    );
    const res = await buildApp().fetch(new Request("http://localhost/api/canonical-info"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.pid).toBe(4242);
    expect(body.ipcPath).toBe("\\\\.\\pipe\\magpie-abcdef012345");
    expect(body.httpPort).toBe(3738);
    expect(body.startedAt).toBe(1715600000000);
  });

  it("returns 503 when discovery file is missing", async () => {
    if (existsSync(LOCK)) unlinkSync(LOCK);
    const res = await buildApp().fetch(new Request("http://localhost/api/canonical-info"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/no canonical/i);
  });

  it("returns 503 when discovery file is corrupt", async () => {
    writeFileSync(LOCK, "not json at all");
    const res = await buildApp().fetch(new Request("http://localhost/api/canonical-info"));
    expect(res.status).toBe(503);
  });

  it("returns 503 when discovery file is missing required fields", async () => {
    writeFileSync(LOCK, JSON.stringify({ pid: 4242 }));
    const res = await buildApp().fetch(new Request("http://localhost/api/canonical-info"));
    expect(res.status).toBe(503);
  });
});
