// v0.9.3 Phase G · G1 — golden path.
//
// add_visual → iterate → compare URL → archive_visual. Asserts version_num
// bumps, current_ver pointer, compare page serves, archived visual drops
// from default find_visuals.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootPair,
  httpGet,
  makeHome,
  mcpCall,
  mcpInit,
  parseVisualId,
  shutdownPair,
  type Pair,
} from "./_helpers.js";

let pair: Pair | undefined;

beforeAll(async () => {
  pair = await bootPair(makeHome("g1"));
  await mcpInit(pair);
}, 120_000);

afterAll(async () => {
  await shutdownPair(pair);
});

describe("G1 · add_visual → iterate → compare → archive", () => {
  it(
    "golden path: full lifecycle of one visual",
    async () => {
      if (!pair) throw new Error("setup failed");

      const add = await mcpCall(pair, "add_visual", {
        project: "g1-golden",
        type: "markdown",
        title: "G1 golden v1",
        content: "# v1\nfirst pass\n",
      });
      expect(add.isError).toBe(false);
      expect(add.text).toMatch(/Saved "G1 golden v1" as visual /);
      const visualId = parseVisualId(add.text);

      const iter = await mcpCall(pair, "iterate", {
        visual_id: visualId,
        message: "v2 revision",
        content: "# v2\nrefined pass\n",
      });
      expect(iter.isError).toBe(false);
      expect(iter.text).toMatch(/v2/);

      const versions = await mcpCall(pair, "list_versions", { visual_id: visualId });
      expect(versions.isError).toBe(false);
      expect(versions.text).toMatch(/^1\s+/m);
      expect(versions.text).toMatch(/^2\s+/m);
      expect(versions.text).toContain("v2 revision");
      expect(versions.text).toContain(`/compare/${visualId}?a=1&b=2`);

      const cmp = await httpGet(pair, `/compare/${visualId}?a=1&b=2`);
      expect(cmp.status).toBe(200);
      expect(cmp.text).toContain(visualId);
      expect(cmp.text).toContain(`/v/${visualId}?ver=1&chrome=0`);
      expect(cmp.text).toContain(`/v/${visualId}?ver=2&chrome=0`);
      expect(cmp.text).toMatch(/data-pane data-ver="1"/);
      expect(cmp.text).toMatch(/data-pane data-ver="2"/);

      const beforeArchive = await mcpCall(pair, "find_visuals", { project: "g1-golden" });
      expect(beforeArchive.text).toContain(visualId);

      const arch = await mcpCall(pair, "archive_visual", { visual_id: visualId });
      expect(arch.isError).toBe(false);
      expect(arch.text).toContain(`Archived "G1 golden v1" (${visualId})`);

      const afterArchive = await mcpCall(pair, "find_visuals", { project: "g1-golden" });
      expect(afterArchive.text).not.toContain(visualId);
    },
    60_000,
  );
});
