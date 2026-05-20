import { homedir } from "node:os";
import { sep, join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactPath, redactPathsIn } from "./redact.js";

const HOME = homedir();

describe("A5 · redactPath · scrub $HOME prefix from log emissions", () => {
  it("replaces a leading $HOME with `~`", () => {
    const p = join(HOME, ".magpie", "last-port");
    expect(redactPath(p)).toBe(`~${sep}.magpie${sep}last-port`);
  });

  it("returns paths outside $HOME unchanged", () => {
    const outside = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/hosts";
    expect(redactPath(outside)).toBe(outside);
  });

  it("is idempotent — re-redacting yields the same result", () => {
    const p = join(HOME, "x");
    const once = redactPath(p);
    const twice = redactPath(once);
    expect(twice).toBe(once);
  });

  it("redacts exact $HOME (no trailing separator)", () => {
    expect(redactPath(HOME)).toBe("~");
  });

  it("does not over-redact a sibling that starts with $HOME but has more chars", () => {
    // /home/omeralt/x must NOT become ~/lt/x when HOME = /home/omer
    if (process.platform === "win32") return;
    const sibling = `${HOME}alt${sep}x`;
    expect(redactPath(sibling)).toBe(sibling);
  });

  it("handles empty string + non-string defensively", () => {
    expect(redactPath("")).toBe("");
    // @ts-expect-error — defensive runtime guard
    expect(redactPath(null)).toBe(null);
    // @ts-expect-error
    expect(redactPath(undefined)).toBe(undefined);
  });

  it("on Windows, is case-insensitive (filesystem paths are case-insensitive)", () => {
    if (process.platform !== "win32") return;
    const upper = HOME.toUpperCase() + sep + "x";
    expect(redactPath(upper)).toMatch(/^~[\\/]x$/);
  });
});

describe("A5 · redactPathsIn · scrub embedded $HOME from free-form messages", () => {
  it("replaces every $HOME occurrence inside a free-form string", () => {
    const msg = `Failed to read ${HOME}/.magpie/db.sqlite and ${HOME}/.magpie/last-port`;
    const redacted = redactPathsIn(msg);
    expect(redacted).not.toContain(HOME);
    expect(redacted.split("~").length - 1).toBe(2);
  });

  it("leaves messages without $HOME alone", () => {
    expect(redactPathsIn("no home here")).toBe("no home here");
  });
});
