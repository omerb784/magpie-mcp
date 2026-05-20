// CANONICAL_RESTART error frame builder. Pure helper, no I/O — kept separate
// from index.ts so it can be unit-tested without booting the runtime.
//
// JSON-RPC custom error code -32099 (implementation-defined range). The
// `data.retryable: true` flag signals to the host MCP SDK that the request
// can be safely re-sent against the new canonical without user intervention.

export const CANONICAL_RESTART_CODE = -32099;
export const CANONICAL_RESTART_MESSAGE = "Magpie canonical restarted; please retry";

export type JsonRpcErrorFrame = {
  jsonrpc: "2.0";
  id: string | number;
  error: {
    code: typeof CANONICAL_RESTART_CODE;
    message: typeof CANONICAL_RESTART_MESSAGE;
    data: { retryable: true; reason: "CANONICAL_RESTART" };
  };
};

export function buildCanonicalRestartError(id: string | number): JsonRpcErrorFrame {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: CANONICAL_RESTART_CODE,
      message: CANONICAL_RESTART_MESSAGE,
      data: { retryable: true, reason: "CANONICAL_RESTART" },
    },
  };
}

export function buildCanonicalRestartErrorsFor(
  ids: Iterable<string | number>,
): JsonRpcErrorFrame[] {
  const out: JsonRpcErrorFrame[] = [];
  for (const id of ids) out.push(buildCanonicalRestartError(id));
  return out;
}
