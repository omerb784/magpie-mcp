import { describe, expect, it } from "vitest";
import {
  VegaLiteRemoteDataError,
  vegaLitePreviewHtml,
  vegaLiteToSvg,
} from "./vegalite.js";

const MIN_BAR = JSON.stringify({
  $schema: "https://vega.github.io/schema/vega-lite/v5.json",
  description: "test",
  data: {
    values: [
      { a: "A", b: 28 },
      { a: "B", b: 55 },
      { a: "C", b: 43 },
    ],
  },
  mark: "bar",
  encoding: {
    x: { field: "a", type: "nominal" },
    y: { field: "b", type: "quantitative" },
  },
});

describe("vegaLiteToSvg", () => {
  it("renders a bar chart spec to a non-trivial SVG", async () => {
    const svg = await vegaLiteToSvg(MIN_BAR);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg.length).toBeGreaterThan(1000);
    const paths = (svg.match(/<path/g) ?? []).length;
    const rects = (svg.match(/<rect/g) ?? []).length;
    expect(paths + rects).toBeGreaterThanOrEqual(4);
    expect(svg).toContain('class="mark-group');
  });

  it("rejects invalid JSON", async () => {
    await expect(vegaLiteToSvg("not json {")).rejects.toThrow(/not valid JSON/i);
  });

  it("rejects spec with remote data url", async () => {
    const spec = JSON.stringify({
      data: { url: "https://example.com/data.json" },
      mark: "bar",
    });
    await expect(vegaLiteToSvg(spec)).rejects.toThrow(VegaLiteRemoteDataError);
  });

  it("rejects nested remote data url inside layer", async () => {
    const spec = JSON.stringify({
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      layer: [
        {
          data: { url: "https://example.com/x.csv" },
          mark: "line",
          encoding: {},
        },
      ],
    });
    await expect(vegaLiteToSvg(spec)).rejects.toThrow(VegaLiteRemoteDataError);
  });

  it("vegaLitePreviewHtml wraps SVG in a centered HTML shell", () => {
    const html = vegaLitePreviewHtml("<svg></svg>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<svg></svg>");
    expect(html).toContain("display:flex");
  });
});
