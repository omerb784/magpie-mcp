import { describe, expect, it } from "vitest";
import { d2DiagramName, d2PreviewHtml, d2ToSvg } from "./d2.js";

describe("d2ToSvg", () => {
  it("renders a simple chain to SVG containing node labels", async () => {
    const svg = await d2ToSvg("a -> b -> c");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain(">a<");
    expect(svg).toContain(">b<");
    expect(svg).toContain(">c<");
  }, 30_000);

  it("throws on syntactically invalid D2", async () => {
    await expect(d2ToSvg("a -> { unclosed")).rejects.toThrow();
  }, 30_000);

  it("d2PreviewHtml wraps SVG in a centered HTML shell", () => {
    const html = d2PreviewHtml("<svg></svg>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<svg></svg>");
    expect(html).toContain("display:flex");
  });

  it("d2DiagramName returns null for empty / invalid source", async () => {
    const name = await d2DiagramName("a -> { unclosed");
    expect(name).toBeNull();
  }, 30_000);
});
