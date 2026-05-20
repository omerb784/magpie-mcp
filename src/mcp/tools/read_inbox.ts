import { z } from "zod";
import { broadcast } from "../../http/ws.js";
import { getInbox, listInbox, markConsumed } from "../../store/inbox.js";
import { getVisual } from "../../store/visuals.js";
import { notifyResourcesChanged } from "../notifications.js";
import { type Tool, textResult } from "../types.js";

const argsSchema = z
  .object({
    count: z.number().int().min(1).max(50).optional(),
    id: z.string().min(1).optional(),
  })
  .strict();

export const readInboxTool: Tool<typeof argsSchema> = {
  name: "read_inbox",
  description: [
    "Read pending prompts the user sent from the Magpie dashboard inbox.",
    "Use when the user says 'check my magpie inbox', 'what did I send?', 'read inbox', or asks to pick up queued work.",
    "Returns pending entries oldest-first with id, visual ref, timestamp, prompt body.",
    "Auto-marks consumed in the same transaction (rows stay in history).",
    "`count` (1-50, default 5) caps batch. `id` reads one entry — idempotent if already consumed.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      count: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Max entries to return (default 5).",
      },
      id: {
        type: "string",
        description:
          "Specific inbox entry id. Mutually optional with count — if both given, id wins.",
      },
    },
    additionalProperties: false,
  },
  argsSchema,
  handler(args) {
    if (args.id) {
      const entry = getInbox(args.id);
      if (!entry) return textResult(`Inbox entry ${args.id} not found.`, true);
      if (entry.consumed_at) {
        return textResult(
          `Inbox entry ${args.id} already consumed at ${entry.consumed_at}.`
        );
      }
      const marked = markConsumed([entry.id]);
      if (marked > 0) {
        notifyResourcesChanged();
        broadcast({ kind: "inbox.consumed", ids: [entry.id] });
      }
      return textResult(renderEntries([entry]));
    }

    const count = args.count ?? 5;
    const pending = listInbox({ status: "pending", limit: count }).reverse();
    if (pending.length === 0) {
      return textResult(
        "Inbox empty — no pending prompts. The user can send one from the dashboard drawer (Talk with agent → Send to inbox)."
      );
    }
    const ids = pending.map((e) => e.id);
    const marked = markConsumed(ids);
    if (marked > 0) {
      notifyResourcesChanged();
      broadcast({ kind: "inbox.consumed", ids });
    }
    return textResult(renderEntries(pending));
  },
};

function renderEntries(entries: { id: string; visual_id: string | null; prompt_body: string; created_at: string }[]): string {
  const header = `Inbox: ${entries.length} pending ${entries.length === 1 ? "entry" : "entries"} consumed.`;
  const stanzas = entries.map((e) => {
    const visualLine = e.visual_id ? renderVisualLine(e.visual_id) : "(no visual_id — free-form send)";
    const ref = e.visual_id ? `\n\nMagpie ref: magpie://visual/${e.visual_id}` : "";
    return `[${e.id}] ${visualLine} · ${e.created_at}\n${e.prompt_body}${ref}`;
  });
  return [header, "", ...stanzas].join("\n");
}

function renderVisualLine(visual_id: string): string {
  const v = getVisual(visual_id);
  if (!v) return `visual ${visual_id} (not found)`;
  return `visual ${v.id} "${v.title}"`;
}
