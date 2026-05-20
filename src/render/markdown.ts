import DOMPurify from "isomorphic-dompurify";
import hljs from "highlight.js/lib/common";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";

const md = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : "";
      try {
        return language
          ? hljs.highlight(code, { language, ignoreIllegals: true }).value
          : hljs.highlightAuto(code).value;
      } catch {
        return code;
      }
    },
  })
);
md.setOptions({ gfm: true, breaks: false });

const STYLES = `
  :root {
    --md-bg: #ffffff;
    --md-fg: #1f2328;
    --md-muted: #59636e;
    --md-border: #d1d9e0;
    --md-border-soft: #eaeef2;
    --md-link: #0969da;
    --md-code-bg: #f6f8fa;
    --md-code-fg: #1f2328;
    --md-block-bg: #f6f8fa;
    --md-accent: #4f46e5;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--md-bg); color: var(--md-fg); }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .wrap { max-width: 980px; margin: 0 auto; padding: 40px 48px 80px; }
  @media (max-width: 720px) { .wrap { padding: 24px 18px 60px; } }

  h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.25; margin: 1.5em 0 0.6em; color: var(--md-fg); }
  h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
  h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--md-border-soft); }
  h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--md-border-soft); }
  h3 { font-size: 1.25em; }
  h4 { font-size: 1em; }
  h5 { font-size: 0.875em; }
  h6 { font-size: 0.85em; color: var(--md-muted); }

  p { margin: 0 0 16px; }
  a { color: var(--md-link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  strong { font-weight: 600; }
  em { font-style: italic; }

  ul, ol { margin: 0 0 16px; padding-left: 2em; }
  ul ul, ul ol, ol ul, ol ol { margin: 4px 0 0; }
  li { margin-top: 4px; }
  li > p { margin: 8px 0; }

  blockquote {
    margin: 0 0 16px;
    padding: 0 1em;
    color: var(--md-muted);
    border-left: 0.25em solid var(--md-border);
  }

  hr {
    height: 1px;
    border: 0;
    background: var(--md-border-soft);
    margin: 24px 0;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 0.85em;
    padding: 0.2em 0.4em;
    background: var(--md-code-bg);
    border-radius: 6px;
    white-space: break-spaces;
  }
  pre {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.85em;
    line-height: 1.5;
    background: var(--md-block-bg);
    padding: 16px;
    overflow: auto;
    border-radius: 6px;
    margin: 0 0 16px;
  }
  pre code { background: transparent; padding: 0; border-radius: 0; font-size: inherit; white-space: pre; }

  .table-scroll { overflow-x: auto; margin: 0 0 16px; -webkit-overflow-scrolling: touch; }
  table { border-collapse: collapse; display: table; width: max-content; max-width: 100%; }
  th, td { padding: 6px 13px; border: 1px solid var(--md-border); }
  th { background: var(--md-block-bg); font-weight: 600; }
  tr { background: var(--md-bg); border-top: 1px solid var(--md-border); }
  tr:nth-child(2n) { background: var(--md-block-bg); }

  img { max-width: 100%; box-sizing: content-box; background: var(--md-bg); }

  kbd {
    display: inline-block;
    padding: 3px 5px;
    font: 11px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    line-height: 10px;
    color: var(--md-fg);
    vertical-align: middle;
    background-color: var(--md-block-bg);
    border: solid 1px var(--md-border);
    border-bottom-color: var(--md-border);
    border-radius: 6px;
    box-shadow: inset 0 -1px 0 var(--md-border);
  }

  /* highlight.js — github theme inlined (subset). */
  .hljs { color: #24292e; background: var(--md-block-bg); }
  .hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
  .hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-name, .hljs-tag { color: #d73a49; }
  .hljs-string, .hljs-title, .hljs-section, .hljs-attribute, .hljs-literal, .hljs-template-tag, .hljs-template-variable, .hljs-type, .hljs-addition { color: #032f62; }
  .hljs-number, .hljs-symbol, .hljs-bullet, .hljs-meta, .hljs-link, .hljs-selector-attr, .hljs-selector-pseudo { color: #005cc5; }
  .hljs-variable, .hljs-class .hljs-title, .hljs-attr, .hljs-doctag, .hljs-selector-id, .hljs-selector-class { color: #6f42c1; }
  .hljs-deletion, .hljs-formula { color: #b31d28; background: #ffeef0; }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: 600; }

  @media (prefers-color-scheme: dark) {
    :root {
      --md-bg: #0d1117;
      --md-fg: #e6edf3;
      --md-muted: #9198a1;
      --md-border: #30363d;
      --md-border-soft: #21262d;
      --md-link: #4493f8;
      --md-code-bg: #6e768166;
      --md-code-fg: #e6edf3;
      --md-block-bg: #151b23;
    }
    .hljs { color: #e6edf3; background: var(--md-block-bg); }
    .hljs-comment, .hljs-quote { color: #8b949e; }
    .hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-name, .hljs-tag { color: #ff7b72; }
    .hljs-string, .hljs-title, .hljs-section, .hljs-attribute, .hljs-literal, .hljs-template-tag, .hljs-template-variable, .hljs-type, .hljs-addition { color: #a5d6ff; }
    .hljs-number, .hljs-symbol, .hljs-bullet, .hljs-meta, .hljs-link, .hljs-selector-attr, .hljs-selector-pseudo { color: #79c0ff; }
    .hljs-variable, .hljs-class .hljs-title, .hljs-attr, .hljs-doctag, .hljs-selector-id, .hljs-selector-class { color: #d2a8ff; }
    .hljs-deletion, .hljs-formula { color: #ffa198; background: #67060c66; }
  }
`;

export function markdownToHtml(content: string): string {
  const rawHtml = md.parse(content, { async: false }) as string;
  const wrappedTables = rawHtml.replace(
    /<table>/g,
    '<div class="table-scroll"><table>'
  ).replace(/<\/table>/g, "</table></div>");
  const safeHtml = DOMPurify.sanitize(wrappedTables, {
    USE_PROFILES: { html: true },
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>${STYLES}</style>
</head>
<body><div class="wrap">${safeHtml}</div></body>
</html>`;
}

export function markdownToHtmlBody(content: string): string {
  const rawHtml = md.parse(content, { async: false }) as string;
  const wrappedTables = rawHtml.replace(
    /<table>/g,
    '<div class="table-scroll"><table>'
  ).replace(/<\/table>/g, "</table></div>");
  return DOMPurify.sanitize(wrappedTables, { USE_PROFILES: { html: true } });
}

export function getMarkdownStyles(): string {
  return STYLES;
}
