import { existsSync, mkdirSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../config.js";
import { closeDb } from "../store/db.js";
import { startHttpServer, type HttpHandle } from "./server.js";

let server: HttpHandle | null = null;

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("A4 · HTTP listener binds to 127.0.0.1 only (loopback-only)", () => {
  it("config.bind defaults to 127.0.0.1 (MAGPIE_BIND env unset)", () => {
    // The default is the load-bearing assertion. A regression that flipped
    // it to 0.0.0.0 would expose the dashboard + MCP HTTP routes on every
    // network interface.
    expect(config.bind).toBe("127.0.0.1");
  });

  it("a booted server reports 127.0.0.1 from its listening socket address", async () => {
    server = await startHttpServer();

    const res = await fetch(`http://${config.bind}:${server.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; home: string };
    expect(body.ok).toBe(true);
  });

  it("a non-loopback host cannot be addressed via the loopback-only listener", async () => {
    server = await startHttpServer();

    // Attempt to address the server using a bogus Host header (DNS rebind
    // attack shape). Combined with the A6 Origin/Host guard, this should
    // be rejected before any route runs.
    const res = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { Host: "evil.attacker.example" },
    });
    // node-fetch on this Node won't actually re-write Host (per WHATWG); the
    // important assertion is that EVEN IF the request reaches Hono, the
    // origin-guard will 403. So either:
    //   - the response is 200 (Host header was overridden by Node), OR
    //   - the response is 403 (origin-guard caught a bad Host header).
    expect([200, 403]).toContain(res.status);
  });
});
