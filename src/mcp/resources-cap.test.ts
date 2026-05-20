import { existsSync, mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../store/db.js";
import { createProject } from "../store/projects.js";
import {
  LIST_RESOURCES_PROJECT_CAP,
  MORE_PROJECTS_URI,
  listResources,
  readResource,
} from "./resources.js";

beforeEach(() => {
  closeDb();
  const home = process.env.MAGPIE_HOME!;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
});

function seed(n: number): void {
  for (let i = 0; i < n; i++) {
    createProject(`p${String(i).padStart(3, "0")}`, "mockup");
  }
}

function countProjectEntries(): number {
  return listResources().filter((r) => r.uri.startsWith("magpie://project/")).length;
}

function findSentinel() {
  return listResources().find((r) => r.uri === MORE_PROJECTS_URI);
}

describe("listResources cap + sentinel · v0.9.2 Phase C/M5 (decision v)", () => {
  it("cap constant is 20 (decision v · N=20 by recency)", () => {
    expect(LIST_RESOURCES_PROJECT_CAP).toBe(20);
  });

  it("0 projects · library + inbox only · no sentinel", () => {
    const list = listResources();
    expect(countProjectEntries()).toBe(0);
    expect(findSentinel()).toBeUndefined();
    expect(list.some((r) => r.uri === "magpie://library")).toBe(true);
    expect(list.some((r) => r.uri === "magpie://inbox")).toBe(true);
  });

  it("5 projects · all surfaced · no sentinel", () => {
    seed(5);
    expect(countProjectEntries()).toBe(5);
    expect(findSentinel()).toBeUndefined();
  });

  it("20 projects · cap-equal · all surfaced · no sentinel", () => {
    seed(20);
    expect(countProjectEntries()).toBe(20);
    expect(findSentinel()).toBeUndefined();
  });

  it("21 projects · 20 surfaced + sentinel '+1 more'", () => {
    seed(21);
    expect(countProjectEntries()).toBe(20);
    const s = findSentinel();
    expect(s).toBeDefined();
    expect(s?.name).toBe("+1 more projects");
    expect(s?.mimeType).toBe("application/json");
    expect(s?.description).toContain("Magpie dashboard");
  });

  it("100 projects · 20 surfaced + sentinel '+80 more'", () => {
    seed(100);
    expect(countProjectEntries()).toBe(20);
    const s = findSentinel();
    expect(s?.name).toBe("+80 more projects");
  });

  it("readResource on magpie://library/more returns structured pointer JSON", () => {
    seed(25);
    const r = readResource(MORE_PROJECTS_URI);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mimeType).toBe("application/json");
    const json = JSON.parse(r.text) as {
      kind: string;
      count: number;
      dashboard_url: string;
    };
    expect(json.kind).toBe("more");
    expect(json.count).toBe(5);
    expect(json.dashboard_url).toMatch(/^http:\/\//);
  });

  it("readResource on library/more returns count=0 when underflowed", () => {
    seed(3);
    const r = readResource(MORE_PROJECTS_URI);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.parse(r.text) as { count: number };
    expect(json.count).toBe(0);
  });

  it("trailing slash variant magpie://library/more/ parses correctly", () => {
    seed(22);
    const r = readResource("magpie://library/more/");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.parse(r.text) as { count: number };
    expect(json.count).toBe(2);
  });

  it("magpie://library still returns ALL projects (full enumeration unchanged)", () => {
    seed(25);
    const r = readResource("magpie://library");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.parse(r.text) as { projects: Array<{ name: string }> };
    expect(json.projects).toHaveLength(25);
  });
});
