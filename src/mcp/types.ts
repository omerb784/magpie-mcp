import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export type ToolResult = CallToolResult;

export interface Tool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: object;
  argsSchema: S;
  handler(args: z.infer<S>): Promise<ToolResult> | ToolResult;
}

export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError };
}
