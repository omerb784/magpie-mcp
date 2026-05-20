type Listener = (connected: boolean) => void;

const sessions = new Set<string>();
const listeners = new Set<Listener>();
let connected = false;

function recompute(): void {
  const next = sessions.size > 0;
  if (connected === next) return;
  connected = next;
  for (const l of listeners) l(next);
}

export function isMcpConnected(): boolean {
  return connected;
}

export function mcpSessionCount(): number {
  return sessions.size;
}

export function addMcpSession(id: string): void {
  sessions.add(id);
  recompute();
}

export function removeMcpSession(id: string): void {
  sessions.delete(id);
  recompute();
}

/**
 * Legacy boolean toggle — preserved for backward compatibility with code that
 * pre-dates per-session tracking. Treated as a single anonymous "default" session.
 * Prefer addMcpSession / removeMcpSession in new code.
 */
export function setMcpConnected(value: boolean): void {
  if (value) {
    addMcpSession("__default__");
  } else {
    removeMcpSession("__default__");
  }
}

export function onMcpStateChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function _resetMcpStateForTest(): void {
  sessions.clear();
  connected = false;
  listeners.clear();
}
