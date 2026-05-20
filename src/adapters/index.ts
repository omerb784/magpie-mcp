import { fenceStripAdapter } from "./fence-strip.js";
import { figmaAdapter } from "./figma.js";
import { icons8Adapter } from "./icons8.js";
import { mermaidChartAdapter } from "./mermaid-chart.js";
import { plainAdapter } from "./plain.js";
import { stitchAdapter } from "./stitch.js";
import { svgmakerAdapter } from "./svgmaker.js";
import type { Adapter, AdapterInput, AdapterOutput } from "./types.js";
import { unknownAdapter } from "./unknown.js";

const SOURCE_ADAPTERS: Adapter[] = [
  stitchAdapter,
  figmaAdapter,
  mermaidChartAdapter,
  svgmakerAdapter,
  icons8Adapter,
];

export function normalize(input: AdapterInput): AdapterOutput {
  let working = input;

  if (fenceStripAdapter.matches(working)) {
    const out = fenceStripAdapter.run(working);
    working = { ...working, content: out.content };
  }

  if (working.source) {
    const sourceMatch = SOURCE_ADAPTERS.find((a) => a.matches(working));
    if (sourceMatch) {
      const out = sourceMatch.run(working);
      return finalize(out, working);
    }
  }

  const plainOut = plainAdapter.run(working);
  return finalize(plainOut, working);
}

function finalize(out: AdapterOutput, input: AdapterInput): AdapterOutput {
  const title = out.title ?? extractTitle(out.content, input.type);
  return { ...out, title };
}

function extractTitle(content: string, type: AdapterInput["type"]): string | null {
  if (type === "html") {
    const m = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
    return m?.[1]?.trim() || null;
  }
  if (type === "svg") {
    const m = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
    return m?.[1]?.trim() || null;
  }
  if (type === "mermaid") {
    const lines = content.trim().split("\n");
    const first = lines[0]?.trim() ?? "";
    return first || null;
  }
  if (type === "markdown") {
    const lines = content.split("\n");
    for (const line of lines) {
      const heading = /^\s*#\s+(.+?)\s*$/.exec(line);
      if (heading?.[1]) return heading[1].trim().slice(0, 200) || null;
    }
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) return trimmed.slice(0, 80);
    }
    return null;
  }
  if (type === "dot") {
    const m = /^\s*(?:strict\s+)?(?:di)?graph\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\{/m.exec(
      content
    );
    return (m?.[1] ?? m?.[2] ?? null) || null;
  }
  if (type === "vega-lite") {
    try {
      const spec = JSON.parse(content) as Record<string, unknown>;
      const title = spec.title;
      if (typeof title === "string" && title.trim().length > 0) {
        return title.trim().slice(0, 200);
      }
      if (
        title &&
        typeof title === "object" &&
        !Array.isArray(title) &&
        typeof (title as { text?: unknown }).text === "string"
      ) {
        const text = ((title as { text: string }).text).trim();
        if (text.length > 0) return text.slice(0, 200);
      }
      const desc = spec.description;
      if (typeof desc === "string" && desc.trim().length > 0) {
        return desc.trim().slice(0, 80);
      }
      return null;
    } catch {
      return null;
    }
  }
  if (type === "d2") {
    const titled = /^\s*title\s*:\s*(.+?)\s*$/m.exec(content);
    if (titled?.[1]) {
      const stripped = titled[1].replace(/^["']|["']$/g, "").trim();
      if (stripped) return stripped.slice(0, 200);
    }
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const labelMatch = /^([A-Za-z_][\w\-.]*)\s*:\s*(.+?)\s*$/.exec(line);
      if (labelMatch?.[2]) {
        const label = labelMatch[2].replace(/^["']|["']$/g, "").trim();
        if (label) return label.slice(0, 80);
      }
      return line.slice(0, 80);
    }
    return null;
  }
  return null;
}

export { unknownAdapter };
