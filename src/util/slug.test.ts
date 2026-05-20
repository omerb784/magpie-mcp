import { describe, expect, it } from "vitest";
import { slugify } from "./slug.js";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World", "fb")).toBe("hello-world");
  });

  it("collapses runs of non-alphanumeric chars", () => {
    expect(slugify("v0.3.0 Smoke — Magpie Architecture", "fb")).toBe(
      "v0-3-0-smoke-magpie-architecture"
    );
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("___hello___", "fb")).toBe("hello");
  });

  it("returns fallback when input has no alphanumerics", () => {
    expect(slugify("———", "fallback-id")).toBe("fallback-id");
  });

  it("returns fallback when input is empty", () => {
    expect(slugify("", "abc123")).toBe("abc123");
  });

  it("preserves digits", () => {
    expect(slugify("v2 Final Approved 2026", "fb")).toBe("v2-final-approved-2026");
  });
});
