import { D2 } from "@terrastruct/d2";
import { config } from "../config.js";

let d2Instance: D2 | null = null;

function getD2(): D2 {
  if (!d2Instance) d2Instance = new D2();
  return d2Instance;
}

export async function d2ToSvg(content: string): Promise<string> {
  const d2 = getD2();
  const renderPromise = (async () => {
    const compiled = await d2.compile(content);
    return d2.render(compiled.diagram, { ...compiled.renderOptions, noXMLTag: true });
  })();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("d2 render timeout")), config.renderTimeoutMs);
  });
  const svg = await Promise.race([renderPromise, timeoutPromise]);
  if (!svg || !svg.includes("<svg")) {
    throw new Error("d2 returned empty / invalid SVG");
  }
  return svg;
}

export function d2PreviewHtml(svg: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { animation: none !important; -webkit-animation: none !important; transition: none !important; -webkit-transition: none !important; }
  html,body{margin:0;padding:0;background:#fff;width:100%;height:100%}
  body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px;box-sizing:border-box}
  body > svg{display:block;width:100%;height:auto;max-width:100%;max-height:calc(100vh - 32px)}
</style>
</head><body>${svg}</body></html>`;
}

export async function d2DiagramName(content: string): Promise<string | null> {
  try {
    const compiled = await getD2().compile(content);
    const name = compiled.diagram?.name;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}
