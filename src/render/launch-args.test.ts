import { describe, it, expect } from "vitest";
import { HARDENED_CHROME_ARGS, renderProfileDir } from "./browser.js";
import { config } from "../config.js";
import { resolve } from "node:path";

describe("S9 · Puppeteer launch hardening · pinned arg list", () => {
  it("HARDENED_CHROME_ARGS is the exact expected pinned list (no insertion or reorder)", () => {
    expect(Array.from(HARDENED_CHROME_ARGS)).toEqual([
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--metrics-recording-only",
      "--disable-breakpad",
    ]);
  });

  it("HARDENED_CHROME_ARGS does NOT contain sandbox-disabling flags", () => {
    const args = Array.from(HARDENED_CHROME_ARGS);
    expect(args).not.toContain("--no-sandbox");
    expect(args).not.toContain("--disable-setuid-sandbox");
    expect(args).not.toContain("--disable-web-security");
    expect(args).not.toContain("--allow-running-insecure-content");
  });

  it("HARDENED_CHROME_ARGS does NOT contain remote-debugging flags", () => {
    const args = Array.from(HARDENED_CHROME_ARGS);
    expect(args.some((a) => a.startsWith("--remote-debugging"))).toBe(false);
  });

  it("HARDENED_CHROME_ARGS is frozen (cannot be mutated at runtime)", () => {
    expect(Object.isFrozen(HARDENED_CHROME_ARGS)).toBe(true);
  });

  it("render profile lives under MAGPIE_HOME, not under HOME directly", () => {
    const profile = renderProfileDir();
    const expected = resolve(config.home, ".render-profile");
    expect(profile).toBe(expected);
    expect(profile.startsWith(config.home)).toBe(true);
    // Sanity: not pointing at a user-Chrome default location.
    expect(profile.toLowerCase()).not.toContain("google");
    expect(profile.toLowerCase()).not.toContain("chromium");
  });
});
