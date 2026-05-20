// v0.9.3 Phase E / T2 - MCP-aware inbox-send toast body.
// When the MCP live indicator says a host is connected, the agent will pick
// up the inbox entry on its next turn; otherwise the user has to paste the
// rendered prompt themselves. Pulled out into its own helper so the choice
// is unit-testable without booting App.tsx.

export function pickInboxToastBody(mcpConnected: boolean): string {
  return mcpConnected
    ? "Sent · agent will pick up next turn"
    : "Sent · paste in your LLM";
}
