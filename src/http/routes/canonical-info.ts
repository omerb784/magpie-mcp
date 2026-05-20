import type { Hono } from "hono";
import { config } from "../../config.js";
import { readCanonicalInfo } from "../../lifecycle/lock.js";

/**
 * GET /api/canonical-info
 *
 * Returns the current canonical's identity ({pid, ipcPath, httpPort, startedAt})
 * read fresh from `$MAGPIE_HOME/magpie.lock` on every call. The dashboard polls
 * this after a WS disconnect/reconnect to detect canonical identity changes
 * caused by Path 2 promotion (R19). When pid differs between calls, the UI
 * shows a "Magpie reconnected" toast.
 *
 * 503 if the lock file is missing or corrupt — usually means canonical is
 * mid-shutdown or this server is a stale facade-promoted instance that hasn't
 * republished yet.
 */
export function mountCanonicalInfoRoutes(app: Hono): void {
  app.get("/api/canonical-info", (c) => {
    const info = readCanonicalInfo(config.home);
    if (!info) {
      return c.json({ error: "no canonical info available" }, 503);
    }
    return c.json({
      pid: info.pid,
      ipcPath: info.ipcPath,
      httpPort: info.httpPort,
      startedAt: info.startedAt,
    });
  });
}
