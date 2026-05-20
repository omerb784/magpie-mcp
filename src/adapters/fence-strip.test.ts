import { describe, expect, it } from "vitest";
import { normalize } from "./index.js";

describe("adapter pipeline — fence strip", () => {
  it("strips ```html fence", () => {
    const out = normalize({
      content: "```html\n<html><title>Hi</title></html>\n```",
      type: "html",
      source: null,
    });
    expect(out.content).toBe("<html><title>Hi</title></html>");
    expect(out.title).toBe("Hi");
    expect(out.status).toBe("ok");
  });

  it("strips ```mermaid fence and pulls first line as title", () => {
    const out = normalize({
      content: "```mermaid\nflowchart LR\n  A --> B\n```",
      type: "mermaid",
      source: null,
    });
    expect(out.content).toBe("flowchart LR\n  A --> B");
    expect(out.title).toBe("flowchart LR");
  });

  it("passes through unfenced content", () => {
    const out = normalize({
      content: '<svg><title>Logo</title></svg>',
      type: "svg",
      source: null,
    });
    expect(out.content).toBe('<svg><title>Logo</title></svg>');
    expect(out.title).toBe("Logo");
  });

  it("respects explicit source", () => {
    const out = normalize({
      content: "<html></html>",
      type: "html",
      source: "stitch",
    });
    expect(out.status).toBe("ok");
  });

  it("does NOT strip fences when type is markdown (fences are legitimate content)", () => {
    const fenced = "```html\n<div>example</div>\n```";
    const out = normalize({
      content: fenced,
      type: "markdown",
      source: null,
    });
    expect(out.content).toBe(fenced);
    expect(out.status).toBe("ok");
  });
});
