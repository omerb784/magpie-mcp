import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../config.js";
import { addMcpSession, removeMcpSession } from "../http/mcp-state.js";
import { handleComplete } from "./completions.js";
import { INSTRUCTIONS } from "./instructions.js";
import { setResourcesListChangedNotifier } from "./notifications.js";
import { PROMPTS, PROMPTS_BY_NAME } from "./prompts/index.js";
import { listResources, readResource } from "./resources.js";
import { TOOLS, TOOLS_BY_NAME } from "./tools/index.js";
import { textResult } from "./types.js";

export type McpContext = {
  /**
   * Working directory of the MCP host that spawned this session. For canonical's
   * own stdio session this is `process.cwd()`; for facade-forwarded sessions
   * the facade reports its own cwd via the `hello` handshake and canonical
   * passes it here. Tool handlers can read it when they need project-auto-grouping
   * context (R8). Optional — tools should fall back to today's behavior if absent.
   */
  originCwd?: string;
  /**
   * Stable identifier for this session. Used by `mcp-state` to track concurrent
   * sessions so the dashboard's "MCP connected" badge reflects ANY live session.
   */
  sessionId: string;
};

// v0.9.2 / Phase C / M10 — listChanged advertised honestly per dimension.
// Tools + prompts are compiled-in and never change at runtime → false. Resources
// listChanged fires on add_visual / archive_visual / merge_projects (etc) so
// `notifications/resources/list_changed` keeps clients in sync. M8 added
// completions:{} per Owner decision iv; logging deferred to v0.9.3.
export const MAGPIE_SERVER_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: true },
  prompts: { listChanged: false },
  completions: {},
} as const;

export function buildMagpieServer(ctx: McpContext): Server {
  const server = new Server(
    { name: "magpie-mcp", version: VERSION },
    {
      capabilities: MAGPIE_SERVER_CAPABILITIES,
      instructions: INSTRUCTIONS,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources(),
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const prompt = PROMPTS_BY_NAME[req.params.name];
    if (!prompt) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown prompt: ${req.params.name}`
      );
    }
    const parsed = prompt.argsSchema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid prompt arguments: ${parsed.error.message}`
      );
    }
    const text = prompt.render(parsed.data);
    return {
      description: prompt.description,
      messages: [
        {
          role: "user",
          content: { type: "text", text },
        },
      ],
    };
  });

  // Error envelope convention (MCP spec, confirmed via S3 audit-v4 review):
  //   - Protocol-level failures use the JSON-RPC `error` envelope. Throwing
  //     `McpError(code, msg)` here surfaces to the client as a JSON-RPC error
  //     with structured code + data — right channel for "unknown resource URI",
  //     "invalid params", "method not found", etc.
  //   - Semantic / domain failures (visual not found, version doesn't exist,
  //     path-guard rejected the input) use `{ isError: true }` on the tool
  //     result. The call SUCCEEDED at the protocol layer but the operation
  //     didn't apply. Tools therefore return via `textResult(msg, true)` for
  //     these cases — see CallTool handler below.
  // Do not collapse the two. Clients distinguish them: protocol errors are
  // surfaced as exceptions, semantic errors flow back as model-readable text.
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const r = readResource(req.params.uri);
    if (!r.ok) {
      throw new McpError(ErrorCode.InvalidParams, r.reason);
    }
    return {
      contents: [
        {
          uri: r.uri,
          mimeType: r.mimeType,
          text: r.text,
        },
      ],
    };
  });

  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const result = handleComplete(req.params.ref, req.params.argument);
    return result as unknown as { completion: { values: string[]; total: number; hasMore: boolean } } & Record<string, unknown>;
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return dispatchCallTool(req.params.name, req.params.arguments ?? {});
  });

  // Notifications fire from any tool's mutation path. Each Server instance
  // owns its own transport, so the SDK fans the notification out per connection.
  setResourcesListChangedNotifier(() => {
    void server.notification({ method: "notifications/resources/list_changed" });
  });

  server.oninitialized = () => addMcpSession(ctx.sessionId);
  server.onclose = () => removeMcpSession(ctx.sessionId);

  return server;
}

// v0.9.2 / Phase C / T1 — uncaught-throw guard. Semantic errors (visual
// not found, path-guard refusal) still return via textResult(msg, true).
// Anything a tool handler *throws* — including a store-layer SQLite error —
// converts to a JSON-RPC InternalError with a single-line, stack-free
// message. Exported so per-tool throw pinning tests don't need a transport.
export async function dispatchCallTool(
  name: string,
  rawArgs: Record<string, unknown> | unknown
): Promise<ReturnType<typeof textResult>> {
  const tool = TOOLS_BY_NAME[name];
  if (!tool) {
    return textResult(`Unknown tool: ${name}`, true);
  }
  const parsed = tool.argsSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return textResult(`Invalid arguments: ${parsed.error.message}`, true);
  }
  try {
    return await tool.handler(parsed.data);
  } catch (err) {
    throw new McpError(ErrorCode.InternalError, formatHandlerThrow(name, err));
  }
}

function formatHandlerThrow(name: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const clamped = firstLine.length > 500 ? firstLine.slice(0, 500) + "…" : firstLine;
  return `Tool ${name} failed: ${clamped || "internal error"}`;
}

/**
 * Attach a fully-built Magpie MCP Server to any transport. Convenience wrapper
 * used by both the canonical's own stdio path and per-facade IPC transports.
 */
export async function attachMagpieServer(transport: Transport, ctx: McpContext): Promise<Server> {
  const server = buildMagpieServer(ctx);
  await server.connect(transport);
  return server;
}

/**
 * Canonical's primary MCP entry point — boots a Server on the process's own
 * stdio. Called once during canonical boot in src/index.ts.
 */
export async function startMcpServer(): Promise<void> {
  await attachMagpieServer(new StdioServerTransport(), {
    sessionId: "canonical-stdio",
    originCwd: process.cwd(),
  });
}
