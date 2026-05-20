// v0.9.3 Phase G · G3 — find_visuals → open_preview → archive.
//
// Tag-AND filter composes · open_preview returns valid URL · archive drops
// from default find · second archive surfaces idempotent "already archived"
// nudge.

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
let aId = "";
let bId = "";
let cId = "";

beforeAll(async () => {
  pair = await bootPair(makeHome("g3"));
  await mcpInit(pair);

  const add = async (title: string, tags: string[]) => {
    const r = await mcpCall(pair!, "add_visual", {
      project: "g3-find",
      type: "markdown",
      title,
      tags,
      content: `# ${title}\n`,
    });
    if (r.isError) throw new Error(`seed ${title} failed: ${r.text}`);
    return parseVisualId(r.text);
  };
  aId = await add("visual-A", ["wip"]);
  bId = await add("visual-B", ["wip", "final"]);
  cId = await add("visual-C", ["final"]);
}, 120_000);

afterAll(async () => {
  await shutdownPair(pair);
});

describe("G3 · find + preview + archive", () => {
  it(
    "tags AND filter picks intersection",
    async () => {
      if (!pair) throw new Error("setup failed");
      const wipOnly = await mcpCall(pair, "find_visuals", { project: "g3-find", tags: ["wip"] });
      expect(wipOnly.text).toContain(aId);
      expect(wipOnly.text).toContain(bId);
      expect(wipOnly.text).not.toContain(cId);

      const both = await mcpCall(pair, "find_visuals", {
        project: "g3-find",
        tags: ["wip", "final"],
      });
      expect(both.text).not.toContain(aId);
      expect(both.text).toContain(bId);
      expect(both.text).not.toContain(cId);
    },
    30_000,
  );

  it(
    "open_preview returns library URL with visual id",
    async () => {
      if (!pair) throw new Error("setup failed");
      const op = await mcpCall(pair, "open_preview", { visual_id: aId });
      expect(op.isError).toBe(false);
      expect(op.text).toContain(`/?visual=${aId}`);
    },
    20_000,
  );

  it(
    "archive drops from default find · second archive is idempotent",
    async () => {
      if (!pair) throw new Error("setup failed");
      const before = await mcpCall(pair, "find_visuals", { project: "g3-find" });
      expect(before.text).toContain(aId);

      const arch = await mcpCall(pair, "archive_visual", { visual_id: aId });
      expect(arch.isError).toBe(false);
      expect(arch.text).toContain(`Archived "visual-A" (${aId})`);

      const after = await mcpCall(pair, "find_visuals", { project: "g3-find" });
      expect(after.text).not.toContain(aId);
      expect(after.text).toContain(bId);

      const arch2 = await mcpCall(pair, "archive_visual", { visual_id: aId });
      expect(arch2.isError).toBe(false);
      expect(arch2.text).toContain("already archived");
    },
    30_000,
  );
});
