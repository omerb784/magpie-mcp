import { describe, it, expect } from "vitest";
import { pickInboxToastBody } from "./inbox-toast";

describe("pickInboxToastBody (v0.9.3 Phase E / T2)", () => {
  it("MCP live - tells user the agent will pick up next turn", () => {
    expect(pickInboxToastBody(true)).toBe("Sent · agent will pick up next turn");
  });

  it("MCP disconnected - falls back to paste-in-LLM hint", () => {
    expect(pickInboxToastBody(false)).toBe("Sent · paste in your LLM");
  });

  it("two branches are distinct strings (snapshot guard)", () => {
    expect(pickInboxToastBody(true)).not.toBe(pickInboxToastBody(false));
  });
});
