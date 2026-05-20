// v0.9.3 Phase F3b — Outbox rework per claude-design return
// (final-ui/views.jsx 207-278 · OutboxView + renderPrompt).
// Prompt-on-top row anatomy · cobalt inline visual-link · state dots ·
// pending vs consumed sections.

import { useCallback, useEffect, useState } from "react";

export interface InboxEntry {
  id: string;
  visual_id: string | null;
  template_id: string | null;
  prompt_body: string;
  vars: Record<string, string> | null;
  created_at: string;
  consumed_at: string | null;
}

interface ListResponse {
  entries: InboxEntry[];
}

export interface OutboxViewProps {
  refreshKey: number;
  pushToast: (
    kind: "info" | "success" | "error",
    msg: string,
    label?: string,
  ) => void;
}

function fmt(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

function truncate(s: string, n = 320): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

// Highlight `magpie://visual/<id>` URIs in the prompt as `.ref` chips so the
// agent's anchors read as cobalt + underlined inline. Pattern is conservative
// — only matches the canonical scheme.
function renderPrompt(body: string): React.ReactNode[] {
  const re = /(magpie:\/\/[\w/.\-]+)/g;
  const truncated = truncate(body);
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(truncated)) !== null) {
    if (m.index > lastIdx) out.push(truncated.slice(lastIdx, m.index));
    out.push(
      <span className="ref" key={key++}>
        {m[1]}
      </span>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < truncated.length) out.push(truncated.slice(lastIdx));
  return out;
}

export function OutboxView(props: OutboxViewProps) {
  const { refreshKey, pushToast } = props;
  const [pending, setPending] = useState<InboxEntry[]>([]);
  const [consumed, setConsumed] = useState<InboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fetch("/api/inbox?status=all")
      .then((r) => (r.ok ? (r.json() as Promise<ListResponse>) : { entries: [] }))
      .then((data) => {
        const all = data.entries ?? [];
        setPending(all.filter((e) => !e.consumed_at));
        setConsumed(all.filter((e) => !!e.consumed_at));
      })
      .catch(() => {
        setPending([]);
        setConsumed([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const undoPending = useCallback(
    async (id: string) => {
      const r = await fetch(`/api/inbox/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        pushToast(
          "error",
          body.error === "already_consumed"
            ? "Cannot undo — agent already picked it up"
            : "Undo failed",
        );
        return;
      }
      pushToast("info", "Entry removed from inbox.", "Outbox");
      refresh();
    },
    [pushToast, refresh],
  );

  return (
    <section className="outbox">
      <header className="page-header">
        <div className="ph-l">
          <h1>
            Outbox <em>queued prompts</em>
          </h1>
          <div className="meta-line">
            Queued prompts the agent picks up via <strong>read_inbox</strong>
            <span className="sep">·</span>Pending waits · Consumed audit trail.
          </div>
        </div>
      </header>

      <header className="ox-section-head">
        <h3>
          <span className="state-dot" /> Pending
          <span className="count">· {pending.length}</span>
        </h3>
        <span className="note">awaiting read_inbox</span>
      </header>
      {loading && pending.length === 0 ? (
        <p className="ox-empty">Loading…</p>
      ) : pending.length === 0 ? (
        <p className="ox-empty">
          No prompts waiting. Send one from a visual's <strong>Talk with agent</strong> drawer.
        </p>
      ) : (
        <ul className="ox-list">
          {pending.map((e) => (
            <OxRow
              key={e.id}
              entry={e}
              expanded={expanded === e.id}
              onToggle={() => setExpanded((cur) => (cur === e.id ? null : e.id))}
              actionLabel="undo send"
              onAction={() => void undoPending(e.id)}
            />
          ))}
        </ul>
      )}

      <header className="ox-section-head">
        <h3>
          <span className="state-dot ok" /> Consumed
          <span className="count">· {consumed.length}</span>
        </h3>
        <span className="note">audit trail</span>
      </header>
      {consumed.length === 0 ? (
        <p className="ox-empty">No history yet.</p>
      ) : (
        <ul className="ox-list">
          {consumed.map((e) => (
            <OxRow
              key={e.id}
              entry={e}
              consumed
              expanded={expanded === e.id}
              onToggle={() => setExpanded((cur) => (cur === e.id ? null : e.id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface OxRowProps {
  entry: InboxEntry;
  consumed?: boolean;
  expanded: boolean;
  onToggle: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

function OxRow({ entry, consumed, expanded, onToggle, actionLabel, onAction }: OxRowProps) {
  return (
    <li className={`ox-row${consumed ? " consumed" : ""}`}>
      <span className="state-col" />
      <span className="id-line">
        <span className="id">{entry.id}</span>
        <span className="sep">·</span>
        <span>{fmt(entry.created_at)}</span>
        {entry.visual_id && (
          <>
            <span className="sep">·</span>
            <span>visual <b>{entry.visual_id}</b></span>
          </>
        )}
        {entry.template_id && (
          <>
            <span className="sep">·</span>
            <span className="tpl">tpl <b>{entry.template_id}</b></span>
          </>
        )}
        {consumed && entry.consumed_at && (
          <>
            <span className="sep">·</span>
            <span className="consumed-at">consumed {fmt(entry.consumed_at)}</span>
          </>
        )}
      </span>
      {actionLabel && onAction && (
        <button type="button" className="right-act" onClick={onAction} title="Remove from inbox (only works while pending)">
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        className="prompt"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ background: "transparent", border: "none", textAlign: "left", padding: 0, cursor: "pointer", font: "inherit", color: "inherit" }}
      >
        {renderPrompt(entry.prompt_body)}
      </button>
      {expanded && <pre className="full">{entry.prompt_body}</pre>}
    </li>
  );
}
