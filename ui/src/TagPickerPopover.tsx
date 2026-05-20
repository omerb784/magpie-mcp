import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, tagColor } from "./Icon.js";

export interface TagAggregate {
  name: string;
  color: string | null;
  count: number;
}

export interface TagPickerPopoverProps {
  pos: { top: number; left: number };
  tags: TagAggregate[];
  activeTags: string[];
  onToggle: (name: string) => void;
  onCreated: () => void;
  onClose: () => void;
  pushToast: (kind: "info" | "success" | "error", msg: string, label?: string) => void;
}

export function TagPickerPopover(props: TagPickerPopoverProps) {
  const { pos, tags, activeTags, onToggle, onCreated, onClose, pushToast } = props;

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (rootRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, query]);

  async function createTag() {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    try {
      const r = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        pushToast("error", `Tag invalid: ${data.error ?? r.status}`);
        return;
      }
      setDraft("");
      setCreating(false);
      onCreated();
      pushToast("info", `Tag "${name}" added`);
    } catch (err) {
      pushToast("error", `Tag add failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="tag-picker"
      role="dialog"
      aria-label="Filter by tag"
      style={{ position: "fixed", top: pos.top, left: pos.left }}
    >
      <div className="tag-picker-search">
        <Icon name="search" size={13} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Filter tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="link-btn" onClick={() => setQuery("")} title="Clear">
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      <div className="tag-picker-list">
        {filtered.length === 0 ? (
          <p className="tag-picker-empty">
            {query ? `No tags match "${query}"` : "No tags yet."}
          </p>
        ) : (
          filtered.map((t) => {
            const active = activeTags.includes(t.name);
            return (
              <button
                key={t.name}
                className={`tag-picker-row${active ? " active" : ""}`}
                onClick={() => onToggle(t.name)}
                aria-pressed={active}
              >
                <span
                  className="dot"
                  style={{ background: t.color ?? tagColor(t.name) }}
                />
                <span className="name">{t.name}</span>
                <span className="count">{t.count}</span>
                {active && <Icon name="check" size={12} className="check" />}
              </button>
            );
          })
        )}
      </div>
      {activeTags.length >= 2 && (
        <p className="tag-picker-and">Multi-select uses AND</p>
      )}
      <div className="tag-picker-foot">
        {creating ? (
          <div className="tag-picker-create">
            <input
              autoFocus
              type="text"
              value={draft}
              maxLength={31}
              placeholder="new-tag-name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createTag();
                else if (e.key === "Escape") {
                  setCreating(false);
                  setDraft("");
                }
              }}
              disabled={busy}
            />
            <button
              className="btn primary"
              onClick={() => void createTag()}
              disabled={busy || !draft.trim()}
            >
              Add
            </button>
            <button
              className="link-btn"
              onClick={() => {
                setCreating(false);
                setDraft("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="tag-picker-new"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={12} />
            New tag
          </button>
        )}
      </div>
    </div>
  );
}
