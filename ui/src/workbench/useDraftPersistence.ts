import { useCallback, useEffect, useRef, useState } from "react";
import type { ReferenceItem } from "../send-template-utils";

export const DRAFT_PREFIX = "magpie.compose.draft.";
export const DRAFT_MAX_BYTES = 50 * 1024;
export const DRAFT_DEBOUNCE_MS = 300;

export interface DraftState {
  varValues: Record<string, string>;
  // S8 P2.C — drafts now carry References, not text examples. Field name
  // kept stable so existing localStorage keys remain backward-compatible
  // shape-wise (the clampBytes path treats both as opaque arrays).
  examples: ReferenceItem[];
  body?: string;
}

export interface DraftRecord extends DraftState {
  savedAt: number;
}

function keyFor(visualId: string, templateId: string): string {
  return `${DRAFT_PREFIX}${visualId}.${templateId}`;
}

export function readDraft(
  visualId: string,
  templateId: string,
): DraftRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(visualId, templateId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftRecord;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.savedAt === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearDraft(visualId: string, templateId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(visualId, templateId));
  } catch {
    // ignore
  }
}

function clampBytes(state: DraftState): DraftState {
  const json = JSON.stringify(state);
  if (json.length <= DRAFT_MAX_BYTES) return state;
  // Trim biggest field first. Body is usually the longest; examples second.
  const next: DraftState = {
    varValues: state.varValues,
    examples: state.examples,
    body: state.body,
  };
  if (next.body && next.body.length > 1024) {
    next.body = next.body.slice(0, Math.max(1024, DRAFT_MAX_BYTES - 4096));
  }
  // If still over, trim examples one at a time from the tail.
  while (
    next.examples.length > 0 &&
    JSON.stringify(next).length > DRAFT_MAX_BYTES
  ) {
    next.examples = next.examples.slice(0, -1);
  }
  return next;
}

export interface UseDraftPersistenceArgs {
  visualId: string | null;
  templateId: string | null;
  state: DraftState;
}

export interface UseDraftPersistenceResult {
  savedAt: number | null;
  showSavedDot: boolean;
  flush: () => void;
}

export function useDraftPersistence({
  visualId,
  templateId,
  state,
}: UseDraftPersistenceArgs): UseDraftPersistenceResult {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showSavedDot, setShowSavedDot] = useState(false);
  const dotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(() => {
    if (!visualId || !templateId) return;
    if (typeof window === "undefined") return;
    try {
      const trimmed = clampBytes(state);
      const record: DraftRecord = {
        ...trimmed,
        savedAt: Date.now(),
      };
      window.localStorage.setItem(
        keyFor(visualId, templateId),
        JSON.stringify(record),
      );
      setSavedAt(record.savedAt);
      setShowSavedDot(true);
      if (dotTimer.current) clearTimeout(dotTimer.current);
      dotTimer.current = setTimeout(() => setShowSavedDot(false), 2200);
    } catch {
      // QuotaExceededError or other — silent. User work is in memory still.
    }
  }, [visualId, templateId, state]);

  useEffect(() => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(persist, DRAFT_DEBOUNCE_MS);
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };
  }, [persist]);

  const flush = useCallback(() => {
    if (writeTimer.current) clearTimeout(writeTimer.current);
    persist();
  }, [persist]);

  return { savedAt, showSavedDot, flush };
}
