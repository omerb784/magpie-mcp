import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import type { PaletteScope, WorkbenchTemplate } from "./types";
import { ScopeChip } from "./ScopeChip";

export interface PaletteEntry {
  id: string;
  name: string;
  desc: string;
  builtin: boolean;
  template: WorkbenchTemplate;
  scope?: PaletteScope;
}

interface CmdKPaletteProps {
  entries: PaletteEntry[];
  onPick: (entry: PaletteEntry) => void;
  onClose: () => void;
}

function fuzzyMatch(query: string, name: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  let qi = 0;
  for (let ni = 0; ni < n.length && qi < q.length; ni++) {
    if (n[ni] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CmdKPalette({ entries, onPick, onClose }: CmdKPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query) return entries;
    return entries.filter((e) => fuzzyMatch(query, e.name) || fuzzyMatch(query, e.desc));
  }, [entries, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const builtins = filtered.filter((e) => e.builtin);
  const saved = filtered.filter((e) => !e.builtin);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered[activeIdx];
      if (entry) onPick(entry);
    }
  }

  return (
    <div
      className="wb-cmdk-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wb-cmdk" role="dialog" aria-label="Pick a template">
        <div className="wb-cmdk-input">
          <span style={{ color: "var(--text-mute)" }}>
            <Icon name="search" size={14} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="search templates…"
            aria-label="search templates"
            style={{
              flex: 1,
              border: 0,
              outline: 0,
              background: "transparent",
              font: "inherit",
              color: "var(--text)",
            }}
          />
          <span className="kbd">esc</span>
        </div>

        {builtins.length > 0 && (
          <>
            <div className="wb-cmdk-section">
              <span className="wb-mono-label">built-ins · {builtins.length}</span>
            </div>
            {builtins.map((entry, i) => {
              const idx = filtered.indexOf(entry);
              const active = idx === activeIdx;
              return (
                <div
                  key={entry.id}
                  className={`wb-cmdk-row ${active ? "active" : ""}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(entry);
                  }}
                >
                  <span style={{ color: "var(--accent)" }}>
                    <Icon name="template" size={13} />
                  </span>
                  <span className="wb-cmdk-name">{entry.name}</span>
                  <span className="wb-cmdk-desc">{entry.desc}</span>
                  {active && <span className="kbd">⏎</span>}
                </div>
              );
            })}
          </>
        )}

        {saved.length > 0 && (
          <>
            <div className="wb-cmdk-section">
              <span className="wb-mono-label">saved · {saved.length}</span>
            </div>
            {saved.map((entry) => {
              const idx = filtered.indexOf(entry);
              const active = idx === activeIdx;
              return (
                <div
                  key={entry.id}
                  className={`wb-cmdk-row ${active ? "active" : ""}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(entry);
                  }}
                >
                  <span style={{ color: "var(--text-mute)" }}>
                    <Icon name="template" size={13} />
                  </span>
                  <span className="wb-cmdk-name">{entry.name}</span>
                  {entry.scope && entry.scope.kind !== "builtin" && (
                    <ScopeChip scope={entry.scope} />
                  )}
                  <span className="wb-cmdk-desc">{entry.desc}</span>
                  {active && <span className="kbd">⏎</span>}
                </div>
              );
            })}
          </>
        )}

        {filtered.length === 0 && (
          <div
            className="wb-cmdk-row"
            style={{
              color: "var(--text-mute)",
              fontStyle: "italic",
              fontFamily: "var(--serif-font)",
              cursor: "default",
            }}
          >
            no matches for “{query}”
          </div>
        )}

        <div className="wb-cmdk-foot">
          <span style={{ display: "flex", gap: "var(--s-3)" }}>
            <span>
              <span className="kbd">↑</span>
              <span className="kbd">↓</span> nav
            </span>
            <span>
              <span className="kbd">⏎</span> insert
            </span>
          </span>
          {/* S7 P5.C — drop misleading "cloned on edit" copy (F13). The
              actual built-in flow is: open in /templates/:id, click
              duplicate, edit the copy. The new link sends users to the
              right surface. */}
          <a
            href="/templates"
            style={{
              marginLeft: "auto",
              color: "var(--accent)",
              fontFamily: "var(--mono-font)",
              fontSize: "10.5px",
              letterSpacing: "0.04em",
              textDecoration: "none",
            }}
            onMouseDown={(e) => {
              // Allow the anchor to do its native navigation; close the
              // palette synchronously so it doesn't flash on its way out.
              e.stopPropagation();
              onClose();
            }}
          >
            ↗ manage templates
          </a>
        </div>
      </div>
    </div>
  );
}
