import { Icon } from "../Icon";
import { resolveSchema } from "./Inputs";
import type { LintWarningV, WorkbenchTemplate } from "./types";

interface StatusStripProps {
  template: WorkbenchTemplate | null;
  varValues: Record<string, string>;
  warnings: LintWarningV[];
  // S7 P7.A — strip needs the free-body length to render an honest free-mode
  // status. When the user is in free mode and has typed, we show the
  // char/tok count and "ready to send". When they haven't typed, we keep
  // the friendly "pick a template to begin" copy but drop the "send always
  // available" caption since send is genuinely disabled in that state.
  freeBody?: string;
  expanded: boolean;
  onToggleExpanded?: () => void;
  onFocusMissing?: (name: string) => void;
}

export function StatusStrip({
  template,
  varValues,
  warnings,
  freeBody = "",
  expanded,
  onToggleExpanded,
  onFocusMissing,
}: StatusStripProps) {
  const schema = template ? resolveSchema(template) : [];
  const total = schema.length;
  const filled = schema.filter((v) => !!varValues[v.name]).length;
  const missing = schema
    .filter((v) => v.required && !varValues[v.name])
    .map((v) => v.name);
  const warnCount = warnings.length;
  const tone = warnCount > 0 ? "warn" : "ok";
  // S7 P7.A — free-mode classification used to honesty-up the strip copy.
  const freeBodyText = freeBody.trim();
  const freeMode = !template;
  const freePopulated = freeMode && freeBodyText.length > 0;
  const sendEnabled = !!template || freePopulated;

  return (
    <div className={`wb-strip tone-${tone} ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="wb-strip-inner"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        style={{
          width: "100%",
          background: "transparent",
          border: 0,
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              color: warnCount > 0 ? "var(--warn-fg)" : "var(--ok-fg)",
              display: "inline-flex",
            }}
          >
            <Icon name={warnCount > 0 ? "alert" : "check"} size={12} />
          </span>
          <span style={{ fontSize: "var(--fs-sm)" }}>
            {template ? (
              <>
                <strong style={{ fontWeight: 500 }}>
                  {total} vars · {filled} filled
                </strong>
                {missing.length > 0 && (
                  <>
                    {" "}
                    · {missing.length} missing (
                    <span
                      role="link"
                      tabIndex={0}
                      className="wb-strip-missing"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFocusMissing?.(missing[0]);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          onFocusMissing?.(missing[0]);
                        }
                      }}
                    >
                      {"{{" + missing[0] + "}}"}
                    </span>
                    {missing.length > 1 && (
                      <span style={{ color: "var(--text-subtle)" }}>
                        {" "}
                        +{missing.length - 1}
                      </span>
                    )}
                    )
                  </>
                )}
                {warnCount > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <span style={{ color: "var(--warn-fg)" }}>
                      {warnCount} lint warning{warnCount > 1 ? "s" : ""}
                    </span>
                  </>
                ) : (
                  <>
                    {" "}
                    · <span style={{ color: "var(--ok-fg)" }}>ready to send</span>
                  </>
                )}
              </>
            ) : freePopulated ? (
              <>
                <strong style={{ fontWeight: 500 }}>
                  free prompt · {freeBodyText.length} chars
                </strong>{" "}
                · <span style={{ color: "var(--ok-fg)" }}>ready to send</span>
              </>
            ) : (
              <span style={{ color: "var(--text-mute)" }}>
                pick a template to begin
              </span>
            )}
          </span>
        </span>
        {/* S7 P7.A (F6/F7) — only advertise "send always available" when send
            actually is. In the empty free-prompt state, send is disabled,
            so the caption was anti-trust. */}
        {sendEnabled && (
          <span style={{ marginLeft: "auto", color: "var(--text-subtle)" }}>
            <span className="wb-mono-label">send always available</span>
          </span>
        )}
      </button>
      {expanded && warnCount > 0 && (
        <div className="wb-strip-detail">
          {warnings.map((w, i) => (
            <div key={i} className="wb-strip-warn">
              <span style={{ color: "var(--warn-fg)" }}>
                <Icon name="alert" size={12} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: "var(--text)",
                  }}
                >
                  {w.message}
                </div>
                <div
                  style={{
                    fontSize: "var(--fs-xs)",
                    color: "var(--text-mute)",
                    fontStyle: "italic",
                    fontFamily: "var(--serif-font)",
                  }}
                >
                  {w.hint}
                </div>
              </div>
              <span
                className="wb-mono-label"
                style={{ flexShrink: 0 }}
              >
                {w.rule}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
