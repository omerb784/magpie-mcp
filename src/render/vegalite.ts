import { parse, View } from "vega";
import { compile } from "vega-lite";
import type { TopLevelSpec } from "vega-lite";
import { config } from "../config.js";

export class VegaLiteRemoteDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VegaLiteRemoteDataError";
  }
}

export async function vegaLiteToSvg(content: string): Promise<string> {
  let spec: TopLevelSpec;
  try {
    spec = JSON.parse(content) as TopLevelSpec;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`vega-lite spec is not valid JSON: ${msg}`);
  }

  if (hasRemoteDataLoader(spec)) {
    throw new VegaLiteRemoteDataError(
      "vega-lite spec references a remote data url; Magpie renders offline only — inline data with `data.values`"
    );
  }

  const renderPromise = (async () => {
    const compiled = compile(spec);
    const view = new View(parse(compiled.spec), { renderer: "none" });
    return view.toSVG();
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("vega-lite render timeout")),
      config.renderTimeoutMs
    );
  });

  const svg = await Promise.race([renderPromise, timeoutPromise]);
  if (!svg || !svg.includes("<svg")) {
    throw new Error("vega returned empty / invalid SVG");
  }
  return svg;
}

export function vegaLitePreviewHtml(svg: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { animation: none !important; -webkit-animation: none !important; transition: none !important; -webkit-transition: none !important; }
  html,body{margin:0;padding:0;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
  svg{display:block;max-width:100vw;max-height:100vh}
</style>
</head><body>${svg}</body></html>`;
}

function hasRemoteDataLoader(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(hasRemoteDataLoader);
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "data" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { url?: unknown }).url === "string"
    ) {
      return true;
    }
    if (hasRemoteDataLoader(value)) return true;
  }
  return false;
}
