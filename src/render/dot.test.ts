import { describe, expect, it } from "vitest";
import { dotPreviewHtml, dotToSvg } from "./dot.js";

describe("dotToSvg", () => {
  it("renders a simple digraph to SVG containing all nodes", async () => {
    const svg = await dotToSvg("digraph G { a -> b -> c }");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain(">a<");
    expect(svg).toContain(">b<");
    expect(svg).toContain(">c<");
  });

  it("renders an undirected graph", async () => {
    const svg = await dotToSvg("graph G { x -- y }");
    expect(svg).toContain("<svg");
    expect(svg).toContain(">x<");
    expect(svg).toContain(">y<");
  });

  it("throws on syntactically invalid DOT", async () => {
    await expect(dotToSvg("digraph { a ->")).rejects.toThrow();
  });

  it("dotPreviewHtml wraps SVG in a centered HTML shell", () => {
    const html = dotPreviewHtml("<svg></svg>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<svg></svg>");
    expect(html).toContain("display:flex");
  });
});
