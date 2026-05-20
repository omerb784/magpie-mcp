import { useMemo } from "react";
import { approxTokens, pillClassNames } from "../send-template-utils";
import type {
  VerSource,
  WorkbenchTemplate,
} from "./types";

interface BodyProps {
  template: WorkbenchTemplate | null;
  verSources?: VerSource[];
  verSourceKey?: string;
  activeVarPill?: string;
  freeBody?: string;
  onChangeFreeBody?: (value: string) => void;
  onPickVerSource?: (key: string) => void;
}

export function Body({
  template,
  verSources,
  verSourceKey,
  activeVarPill,
  freeBody,
  onChangeFreeBody,
  onPickVerSource,
}: BodyProps) {
  if (!template) {
    const value = freeBody ?? "";
    // S7 P7.E (F15) — when the workbench is mounted from a compare or
    // preview-historical surface, surface a hint above the textarea that
    // the active version is implicit. The picker stays interactive so
    // the user can still pivot the contextual version. The send payload
    // itself does NOT yet inject {visual_ref}; this is informational
    // only until product validates the wire change in S8+.
    const showFreeHint =
      !!verSources &&
      verSources.length >= 2 &&
      !!verSourceKey;
    const activeSrc = showFreeHint
      ? verSources!.find((s) => s.key === verSourceKey)
      : undefined;
    return (
      <div className="wb-body wb-body-free">
        <div className="wb-section-head">
          <span className="wb-mono-label">free prompt</span>
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: "var(--s-2)",
              alignItems: "center",
            }}
          >
            <span className="wb-mono-label">
              {approxTokens(value)} tok · {value.length} chars
            </span>
          </span>
        </div>
        {showFreeHint && activeSrc && (
          <div
            className="wb-free-hint"
            style={{
              padding: "var(--s-2) var(--s-3)",
              fontSize: "var(--fs-xs)",
              color: "var(--text-mute)",
              fontFamily: "var(--mono-font)",
              borderBottom: "1px solid var(--hr)",
              background: "var(--surface-2)",
              display: "flex",
              alignItems: "center",
              gap: "var(--s-2)",
            }}
          >
            <span>your prompt will reference v{activeSrc.ver}</span>
            <VerSourcesPicker
              sources={verSources!}
              active={verSourceKey}
              onPick={onPickVerSource}
            />
          </div>
        )}
        <textarea
          className="wb-free-textarea"
          value={value}
          onChange={(e) => onChangeFreeBody?.(e.target.value)}
          placeholder="pick a template above, or type a free prompt here."
          aria-label="free prompt"
          spellCheck={false}
          rows={6}
        />
      </div>
    );
  }
  const body = template.body;
  const segments = useMemo(() => renderBodyWithPills(body, activeVarPill), [body, activeVarPill]);
  const showVerPicker =
    !!verSources && verSources.length >= 2 && /\{\{ver\}\}/.test(body);
  return (
    <div className="wb-body">
      <div className="wb-section-head">
        <span className="wb-mono-label">body</span>
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: "var(--s-2)",
            alignItems: "center",
          }}
        >
          <span className="wb-mono-label">
            {approxTokens(body)} tok · {body.length} chars
          </span>
        </span>
      </div>
      <pre className="wb-body-pre">{segments}</pre>
      {showVerPicker && (
        <VerSourcesPicker
          sources={verSources!}
          active={verSourceKey}
          onPick={onPickVerSource}
        />
      )}
    </div>
  );
}

interface VerSourcesPickerProps {
  sources: VerSource[];
  active?: string;
  onPick?: (key: string) => void;
}

function VerSourcesPicker({
  sources,
  active,
  onPick,
}: VerSourcesPickerProps) {
  return (
    <div className="wb-versources">
      <span
        className="wb-mono-label"
        style={{ marginRight: "var(--s-2)" }}
      >
        {"{{ver}}"} →
      </span>
      <div className="wb-versources-seg" role="radiogroup" aria-label="version source">
        {sources.map((s) => {
          const isActive = s.key === active;
          const tone = s.tone || "neutral";
          return (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={`wb-versources-btn tone-${tone} ${isActive ? "active" : ""}`}
              onClick={() => onPick?.(s.key)}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function renderBodyWithPills(body: string, activeVar?: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const re = /\{\{([a-z][a-z0-9_]{0,15})\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) {
      parts.push(<span key={key++}>{body.slice(last, m.index)}</span>);
    }
    const name = m[1];
    // S8 P6.B — pillClassNames cascades ref → sys → user; activeVar drives
    // the P6.C highlight when the matching References row is focused.
    parts.push(
      <span key={key++} className={pillClassNames(name, activeVar)}>
        {"{{" + name + "}}"}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) {
    parts.push(<span key={key++}>{body.slice(last)}</span>);
  }
  return parts;
}
