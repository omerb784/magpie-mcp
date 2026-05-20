// v0.9.3 Phase G · G5 — rename + merge_projects.
//
// Rename to existing name → collision error · no DB mutation.
// Merge src → dst → visuals reparented · src archived · tag + version chains
// preserved.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootPair,
  makeHome,
  mcpCall,
  mcpInit,
  parseVisualId,
  shutdownPair,
  type Pair,
} from "./_helpers.js";

let pair: Pair | undefined;
let srcIds: string[] = [];
let dstIds: string[] = [];

beforeAll(async () => {
  pair = await bootPair(makeHome("g5"));
  await mcpInit(pair);

  const seed = async (project: string, title: string, tags: string[]) => {
    const r = await mcpCall(pair!, "add_visual", {
      project,
      type: "markdown",
      title,
      tags,
      content: `# ${title}\n`,
    });
    if (r.isError) throw new Error(`seed ${title} failed: ${r.text}`);
    return parseVisualId(r.text);
  };
  srcIds = [
    await seed("g5-src", "src-A", ["alpha"]),
    await seed("g5-src", "src-B", ["beta"]),
  ];
  dstIds = [
    await seed("g5-dst", "dst-A", ["gamma"]),
    await seed("g5-dst", "dst-B", ["delta"]),
  ];

  // Bump src-A to v2 so we can verify version chain survives the merge.
  const iter = await mcpCall(pair, "iterate", {
    visual_id: srcIds[0]!,
    content: "# src-A v2\n",
    message: "bump",
  });
  if (iter.isError) throw new Error(`iter failed: ${iter.text}`);
}, 120_000);

afterAll(async () => {
  await shutdownPair(pair);
});

describe("G5 · rename + merge", () => {
  it(
    "rename to existing project → collision error · no mutation",
    async () => {
      if (!pair) throw new Error("setup failed");
      const r = await mcpCall(pair, "update_project", {
        old_name: "g5-src",
        new_name: "g5-dst",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/already exists/);

      const listed = await mcpCall(pair, "list_projects", {});
      expect(listed.text).toContain("g5-src");
      expect(listed.text).toContain("g5-dst");
    },
    30_000,
  );

  it(
    "merge src → dst · visuals reparented · src archived · version chain preserved",
    async () => {
      if (!pair) throw new Error("setup failed");
      const r = await mcpCall(pair, "merge_projects", {
        src_name: "g5-src",
        dst_name: "g5-dst",
      });
      expect(r.isError).toBe(false);
      expect(r.text).toMatch(/Moved 2 visual\(s\)/);
      expect(r.text).toContain('"g5-src" archived');

      const inDst = await mcpCall(pair, "find_visuals", { project: "g5-dst" });
      for (const id of [...srcIds, ...dstIds]) {
        expect(inDst.text).toContain(id);
      }

      const inSrc = await mcpCall(pair, "find_visuals", { project: "g5-src" });
      expect(inSrc.text).toMatch(/No matches/);

      const listed = await mcpCall(pair, "list_projects", {});
      expect(listed.text).not.toMatch(/^g5-src\s+/m);
      expect(listed.text).toContain("g5-dst");

      // Version chain on src-A survived the reparent.
      const versions = await mcpCall(pair, "list_versions", { visual_id: srcIds[0]! });
      expect(versions.text).toMatch(/^1\s+/m);
      expect(versions.text).toMatch(/^2\s+/m);
      expect(versions.text).toContain("bump");

      // Tags survived the reparent — alpha still attached to src-A.
      const byTag = await mcpCall(pair, "find_visuals", { tags: ["alpha"] });
      expect(byTag.text).toContain(srcIds[0]!);
    },
    30_000,
  );

  it(
    "merge with non-existent src → prose error",
    async () => {
      if (!pair) throw new Error("setup failed");
      const r = await mcpCall(pair, "merge_projects", {
        src_name: "g5-never-was",
        dst_name: "g5-dst",
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/source project .* not found/);
    },
    20_000,
  );
});
