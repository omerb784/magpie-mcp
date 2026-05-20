import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { config } from "../config.js";

let graphvizInstance: Awaited<ReturnType<typeof Graphviz.load>> | null = null;

async function getGraphviz(): Promise<Awaited<ReturnType<typeof Graphviz.load>>> {
  if (!graphvizInstance) {
    graphvizInstance = await Graphviz.load();
  }
  return graphvizInstance;
}

export async function dotToSvg(content: string): Promise<string> {
  const gv = await getGraphviz();
  const layoutPromise = Promise.resolve().then(() => gv.layout(content, "svg", "dot"));
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("dot render timeout")), config.renderTimeoutMs);
  });
  const svg = await Promise.race([layoutPromise, timeoutPromise]);
  if (!svg || !svg.includes("<svg")) {
    throw new Error("graphviz returned empty / invalid SVG");
  }
  return svg;
}

export function dotPreviewHtml(svg: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { animation: none !important; -webkit-animation: none !important; transition: none !important; -webkit-transition: none !important; }
  html,body{margin:0;padding:0;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
  svg{display:block;max-width:100vw;max-height:100vh}
</style>
</head><body>${svg}</body></html>`;
}
