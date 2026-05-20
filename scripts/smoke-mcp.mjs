import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, "dist", "index.js");
const HOME = join(root, ".tmp-smoke-home");

const child = spawn(process.execPath, [entry], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, MAGPIE_HOME: HOME },
});

const errBuf = [];
child.stderr.on("data", (b) => errBuf.push(b));

let lineBuf = "";
const pending = new Map();
let nextId = 1;

function rpc(method, params) {
  const id = nextId++;
  const req = { jsonrpc: "2.0", id, method, params };
  child.stdin.write(JSON.stringify(req) + "\n");
  return new Promise((resolve) => pending.set(id, resolve));
}

child.stdout.on("data", (chunk) => {
  lineBuf += chunk.toString("utf8");
  let idx;
  while ((idx = lineBuf.indexOf("\n")) >= 0) {
    const line = lineBuf.slice(0, idx).trim();
    lineBuf = lineBuf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch (e) {
      console.log("[non-json]", line);
    }
  }
});

const HTML_SAMPLE = "```html\n<!doctype html><html><head><title>CRM Dashboard</title></head><body><h1>Sales Pipeline</h1></body></html>\n```";
const HTML_V2 = "<!doctype html><html><head><title>CRM Dashboard — dark</title></head><body style=\"background:#0b1220;color:#e2e8f0\"><h1>Sales Pipeline</h1></body></html>";
const MERMAID_SAMPLE = "```mermaid\nflowchart LR\n  A[User] --> B[Magpie]\n  B --> C[(SQLite)]\n```";

function extractVisualId(text) {
  const m = /visual\s+([A-Za-z0-9_-]+)/.exec(text);
  return m?.[1] ?? null;
}

function extractPort(stderr) {
  const m = /dashboard:\s*http:\/\/[^:]+:(\d+)/.exec(stderr);
  return m ? Number(m[1]) : null;
}

(async () => {
  const initRes = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.1" },
  });
  console.log("[init] ok, server:", initRes.result?.serverInfo?.name);

  const listRes = await rpc("tools/list", {});
  console.log("[tools/list]", listRes.result?.tools?.length, "tools");

  const addHtml = await rpc("tools/call", {
    name: "add_visual",
    arguments: {
      project: "crm-demo",
      type: "html",
      content: HTML_SAMPLE,
      tags: ["wip"],
      source: "claude",
    },
  });
  const htmlText = addHtml.result?.content?.[0]?.text ?? "";
  console.log("[add_visual html]\n", htmlText);
  const htmlVid = extractVisualId(htmlText);

  const addMer = await rpc("tools/call", {
    name: "add_visual",
    arguments: {
      project: "crm-demo",
      type: "mermaid",
      content: MERMAID_SAMPLE,
    },
  });
  const merText = addMer.result?.content?.[0]?.text ?? "";
  console.log("[add_visual mermaid]\n", merText);
  const merVid = extractVisualId(merText);

  const iterRes = await rpc("tools/call", {
    name: "iterate",
    arguments: {
      visual_id: htmlVid,
      content: HTML_V2,
      message: "dark mode",
    },
  });
  console.log("[iterate]\n", iterRes.result?.content?.[0]?.text ?? "");

  const versRes = await rpc("tools/call", {
    name: "list_versions",
    arguments: { visual_id: htmlVid },
  });
  console.log("[list_versions]\n", versRes.result?.content?.[0]?.text ?? "");

  const projRes = await rpc("tools/call", {
    name: "list_projects",
    arguments: {},
  });
  console.log("[list_projects]\n", projRes.result?.content?.[0]?.text ?? "");

  const stderr = Buffer.concat(errBuf).toString("utf8");
  const port = extractPort(stderr);
  console.log("[http port]", port);

  if (port && htmlVid) {
    const r1 = await fetch(`http://127.0.0.1:${port}/api/visuals/${htmlVid}`);
    console.log("[GET /api/visuals/:id]", r1.status);
    const j1 = await r1.json();
    console.log("  current_ver:", j1.visual?.current_ver, "versions:", j1.versions?.length, "tags:", j1.tags?.map(t=>t.name));

    const r2 = await fetch(`http://127.0.0.1:${port}/v/${htmlVid}`);
    console.log("[GET /v/:id html]", r2.status, r2.headers.get("content-type"));
    const body = await r2.text();
    console.log("  preview body length:", body.length, "starts:", body.slice(0, 60));

    if (merVid) {
      const r3 = await fetch(`http://127.0.0.1:${port}/v/${merVid}`);
      console.log("[GET /v/:id mermaid]", r3.status, r3.headers.get("content-type"));
      const mbody = await r3.text();
      console.log("  mermaid shell length:", mbody.length, "has cdn:", mbody.includes("cdn.jsdelivr.net"));
    }
  }

  // Verify blob written
  const blobDir = join(HOME, "blobs");
  if (existsSync(blobDir) && htmlVid) {
    const blobPath = join(blobDir, htmlVid, "v1.html");
    if (existsSync(blobPath)) {
      const c = readFileSync(blobPath, "utf8");
      console.log("[blob v1.html]", c.length, "bytes, fence stripped:", !c.includes("```"));
    }
    const blobV2 = join(blobDir, htmlVid, "v2.html");
    if (existsSync(blobV2)) {
      const c = readFileSync(blobV2, "utf8");
      console.log("[blob v2.html]", c.length, "bytes, dark mode:", c.includes("background:#0b1220"));
    }
  }

  // Wait for renders (puppeteer is async — give it up to 30s)
  if (port && htmlVid) {
    const targets = [
      [htmlVid, 1],
      [htmlVid, 2],
      ...(merVid ? [[merVid, 1]] : []),
    ];
    const deadline = Date.now() + 30_000;
    const pending = new Set(targets.map(([v, n]) => `${v}:${n}`));
    while (pending.size > 0 && Date.now() < deadline) {
      for (const key of [...pending]) {
        const [v, n] = key.split(":");
        const r = await fetch(`http://127.0.0.1:${port}/thumbs/${v}/v${n}.png`);
        if (r.status === 200) {
          const buf = Buffer.from(await r.arrayBuffer());
          console.log(`[thumb ${v} v${n}]`, r.status, buf.length, "bytes");
          pending.delete(key);
        }
      }
      if (pending.size > 0) await new Promise((r) => setTimeout(r, 500));
    }
    if (pending.size > 0) {
      console.log("[thumb] still pending:", [...pending]);
    }

    const r = await fetch(`http://127.0.0.1:${port}/api/visuals/${htmlVid}`);
    const j = await r.json();
    console.log("[render statuses]", j.versions?.map((x) => `v${x.version_num}:${x.render_status}`));
  }

  // ───── S1 surface (Phase 2 + 3 tools + Resources) ─────
  console.log("\n=== S1 SMOKE ===");

  // Add a third visual in a separate project so search/merge has variety
  const addSecond = await rpc("tools/call", {
    name: "add_visual",
    arguments: {
      project: "pricing-page",
      type: "html",
      content: "<!doctype html><html><body><h1>Pricing</h1></body></html>",
      tags: ["wip"],
    },
  });
  const secondText = addSecond.result?.content?.[0]?.text ?? "";
  const secondVid = extractVisualId(secondText);
  console.log("[add_visual pricing]", secondVid);

  // find_visuals: by query, project, tag, type
  const fvAll = await rpc("tools/call", { name: "find_visuals", arguments: {} });
  console.log("[find_visuals all]\n", fvAll.result?.content?.[0]?.text);
  const fvQuery = await rpc("tools/call", { name: "find_visuals", arguments: { query: "Pricing" } });
  console.log("[find_visuals query=Pricing]\n", fvQuery.result?.content?.[0]?.text);
  const fvTag = await rpc("tools/call", { name: "find_visuals", arguments: { tag: "wip" } });
  console.log("[find_visuals tag=wip]\n", fvTag.result?.content?.[0]?.text);
  const fvType = await rpc("tools/call", { name: "find_visuals", arguments: { type: "mermaid" } });
  console.log("[find_visuals type=mermaid]\n", fvType.result?.content?.[0]?.text);
  const fvProj = await rpc("tools/call", { name: "find_visuals", arguments: { project: "crm-demo" } });
  console.log("[find_visuals project=crm-demo]\n", fvProj.result?.content?.[0]?.text);

  // open_preview defaults + explicit version
  const opDef = await rpc("tools/call", { name: "open_preview", arguments: { visual_id: htmlVid } });
  console.log("[open_preview default]\n", opDef.result?.content?.[0]?.text);
  const opVer = await rpc("tools/call", { name: "open_preview", arguments: { visual_id: htmlVid, version: 1 } });
  console.log("[open_preview ver=1]\n", opVer.result?.content?.[0]?.text);

  // compare default + bad version
  const cmp = await rpc("tools/call", { name: "compare", arguments: { visual_id: htmlVid } });
  console.log("[compare default]\n", cmp.result?.content?.[0]?.text);
  const cmpBad = await rpc("tools/call", { name: "compare", arguments: { visual_id: htmlVid, a: 1, b: 99 } });
  console.log("[compare missing-ver isError]", cmpBad.result?.isError, cmpBad.result?.content?.[0]?.text);

  // update_visual rename + retag + star
  const upd = await rpc("tools/call", {
    name: "update_visual",
    arguments: { visual_id: secondVid, title: "Pricing — clean", tags: ["final", "approved"], starred: true },
  });
  console.log("[update_visual]\n", upd.result?.content?.[0]?.text);
  const fvStar = await rpc("tools/call", { name: "find_visuals", arguments: { starred: true } });
  console.log("[find_visuals starred=true]\n", fvStar.result?.content?.[0]?.text);

  // archive_visual + verify hidden
  const arcVis = await rpc("tools/call", { name: "archive_visual", arguments: { visual_id: merVid } });
  console.log("[archive_visual mermaid]\n", arcVis.result?.content?.[0]?.text);
  const fvAfter = await rpc("tools/call", { name: "find_visuals", arguments: { type: "mermaid" } });
  console.log("[find_visuals type=mermaid AFTER archive]\n", fvAfter.result?.content?.[0]?.text);

  // rename_project
  const rn = await rpc("tools/call", {
    name: "rename_project",
    arguments: { old_name: "pricing-page", new_name: "pricing-v2" },
  });
  console.log("[rename_project]\n", rn.result?.content?.[0]?.text);

  // merge_projects: add another visual to a 3rd project, then merge into crm-demo
  const addThird = await rpc("tools/call", {
    name: "add_visual",
    arguments: {
      project: "scratch",
      type: "html",
      content: "<!doctype html><html><body><h1>scratch</h1></body></html>",
    },
  });
  console.log("[add scratch]", extractVisualId(addThird.result?.content?.[0]?.text ?? ""));
  const mp = await rpc("tools/call", {
    name: "merge_projects",
    arguments: { src_name: "scratch", dst_name: "crm-demo" },
  });
  console.log("[merge_projects]\n", mp.result?.content?.[0]?.text);

  // archive_project
  const arcProj = await rpc("tools/call", {
    name: "archive_project",
    arguments: { name: "pricing-v2" },
  });
  console.log("[archive_project pricing-v2]\n", arcProj.result?.content?.[0]?.text);
  const lpAfter = await rpc("tools/call", { name: "list_projects", arguments: {} });
  console.log("[list_projects after archives]\n", lpAfter.result?.content?.[0]?.text);

  // Resources
  const resList = await rpc("resources/list", {});
  console.log("[resources/list count]", resList.result?.resources?.length);
  console.log("  uris:", resList.result?.resources?.map((r) => r.uri));

  const resLib = await rpc("resources/read", { uri: "magpie://library" });
  console.log("[resources/read library mime]", resLib.result?.contents?.[0]?.mimeType);
  console.log("  text:\n", resLib.result?.contents?.[0]?.text);

  const resProj = await rpc("resources/read", { uri: "magpie://project/crm-demo" });
  console.log("[resources/read project mime]", resProj.result?.contents?.[0]?.mimeType);
  console.log("  text:\n", resProj.result?.contents?.[0]?.text);

  const resVis = await rpc("resources/read", { uri: `magpie://visual/${htmlVid}` });
  console.log("[resources/read visual current mime]", resVis.result?.contents?.[0]?.mimeType, "len:", resVis.result?.contents?.[0]?.text?.length);

  const resVisV1 = await rpc("resources/read", { uri: `magpie://visual/${htmlVid}/v1` });
  console.log("[resources/read visual v1 mime]", resVisV1.result?.contents?.[0]?.mimeType, "len:", resVisV1.result?.contents?.[0]?.text?.length);

  console.log("\n=== S1 SMOKE OK ===");

  child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500);
})().catch((e) => {
  console.error("smoke failed:", e);
  child.kill("SIGTERM");
  process.exit(1);
});
