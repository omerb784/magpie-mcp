import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./markdown.js";

describe("markdownToHtml", () => {
  it("renders headings as <h1>/<h2>", () => {
    const out = markdownToHtml("# Hello\n\n## World");
    expect(out).toContain("<h1");
    expect(out).toContain(">Hello</h1>");
    expect(out).toContain("<h2");
    expect(out).toContain(">World</h2>");
  });

  it("renders fenced code blocks as <pre><code> with syntax highlighting", () => {
    const out = markdownToHtml("```js\nconst a = 1;\n```");
    expect(out).toContain("<pre>");
    expect(out).toContain('<code class="hljs language-js">');
    expect(out).toContain('class="hljs-keyword">const</span>');
    expect(out).toContain('class="hljs-number">1</span>');
  });

  it("falls back to auto-detection when language fence is omitted", () => {
    const out = markdownToHtml("```\nconsole.log(1);\n```");
    expect(out).toContain('<code class="hljs">');
  });

  it("sanitizes <script> tags", () => {
    const out = markdownToHtml("hello\n\n<script>alert('xss')</script>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(");
  });

  it("sanitizes inline event handlers", () => {
    const out = markdownToHtml('<img src="x" onerror="alert(1)" />');
    expect(out).not.toMatch(/onerror=/i);
  });

  it("supports GFM tables", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const out = markdownToHtml(md);
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain("<td");
  });

  it("wraps output in a full HTML document with the typography stylesheet", () => {
    const out = markdownToHtml("hi");
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("<style>");
    expect(out).toContain('<div class="wrap">');
  });
});
