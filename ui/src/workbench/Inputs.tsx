import { extractVarNames, resolveReferences } from "../send-template-utils";
import type { VarSchemaItem, WorkbenchTemplate } from "./types";

interface InputsProps {
  template: WorkbenchTemplate | null;
  values: Record<string, string>;
  activeVarPill?: string;
  onChangeVar?: (name: string, value: string) => void;
  onFocusVar?: (name: string | undefined) => void;
}

export function resolveSchema(template: WorkbenchTemplate): VarSchemaItem[] {
  if (template.varSchema && template.varSchema.length > 0) return template.varSchema;
  return extractVarNames(template.body).map((name) => ({
    name,
    type: "string" as const,
    required: false,
  }));
}

export function Inputs({
  template,
  values,
  activeVarPill,
  onChangeVar,
  onFocusVar,
}: InputsProps) {
  if (!template) return null;
  const schema = resolveSchema(template);
  // S8 P7.A — read-only ref rows surface above the typed-var rows. The
  // refMap is the same magpie:// URI the LLM will see at send time. Helps
  // the user verify the picker pick before hitting send.
  const { refMap } = resolveReferences(template.body, template.examples ?? null);
  const refs = template.examples ?? [];
  if (schema.length === 0 && refs.length === 0) {
    return (
      <div className="wb-inputs-empty">
        <span className="wb-mono-label">no inputs</span>
        <span
          style={{
            fontFamily: "var(--serif-font)",
            fontStyle: "italic",
            color: "var(--text-subtle)",
            fontSize: "var(--fs-sm)",
          }}
        >
          this template takes no variables.
        </span>
      </div>
    );
  }
  const filled = schema.filter((v) => !!values[v.name]).length;
  return (
    <div className="wb-inputs">
      <div className="wb-section-head">
        <span className="wb-mono-label">inputs</span>
        <span
          style={{
            fontSize: "var(--fs-2xs)",
            color: "var(--text-subtle)",
            marginLeft: "auto",
            fontFamily: "var(--mono-font)",
            letterSpacing: "var(--tracking-mono-tight)",
          }}
        >
          {schema.length} · {filled} filled
          {refs.length > 0 && (
            <> · {refs.length} ref{refs.length === 1 ? "" : "s"}</>
          )}
        </span>
      </div>
      {refs.map((r) => {
        const uri = refMap[r.name];
        const focused = activeVarPill === r.name;
        return (
          <div
            key={r.name}
            className={`wb-input-row wb-ref-row ${focused ? "focused" : ""}`}
            onMouseEnter={() => onFocusVar?.(r.name)}
            onMouseLeave={() => onFocusVar?.(undefined)}
          >
            <label className="wb-input-label">
              <span
                style={{
                  fontFamily: "var(--mono-font)",
                  fontSize: "var(--fs-sm)",
                  color: "var(--moss)",
                }}
              >
                {r.name}
              </span>
            </label>
            <div className="wb-ref-uri">
              <code className="wb-ref-uri-text">{uri ?? `magpie://visual/${r.visual_id}`}</code>
              {r.visual_id && (
                <a
                  className="wb-ref-open"
                  href={
                    r.visual_version != null
                      ? `/v/${r.visual_id}?ver=${r.visual_version}`
                      : `/v/${r.visual_id}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  title="open visual"
                >
                  open ↗
                </a>
              )}
            </div>
          </div>
        );
      })}
      {schema.map((v) => {
        const val = values[v.name] ?? "";
        const empty = !!v.required && val.length === 0;
        const focused = activeVarPill === v.name;
        return (
          <div
            key={v.name}
            className={`wb-input-row ${focused ? "focused" : ""}`}
          >
            <label className="wb-input-label" htmlFor={`wb-in-${v.name}`}>
              <span
                style={{
                  fontFamily: "var(--mono-font)",
                  fontSize: "var(--fs-sm)",
                  color: "var(--text)",
                }}
              >
                {v.name}
                {v.required && (
                  <span style={{ color: "var(--warn-fg)", marginLeft: 2 }}>
                    *
                  </span>
                )}
              </span>
            </label>
            {renderInput(v, val, empty, {
              onChange: (next) => onChangeVar?.(v.name, next),
              onFocus: () => onFocusVar?.(v.name),
              onBlur: () => onFocusVar?.(undefined),
            })}
          </div>
        );
      })}
    </div>
  );
}

interface InputHandlers {
  onChange: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

function renderInput(
  v: { name: string; type: string; default?: string; options?: string[] },
  val: string,
  empty: boolean,
  h: InputHandlers,
) {
  const placeholder = v.default || `<${v.name}>`;
  const baseClass = `wb-input ${empty ? "empty" : ""}`;
  if (v.type === "enum") {
    const opts = v.options ?? [];
    return (
      <select
        id={`wb-in-${v.name}`}
        className={baseClass}
        value={val}
        onChange={(e) => h.onChange(e.target.value)}
        onFocus={h.onFocus}
        onBlur={h.onBlur}
      >
        <option value="" disabled>
          choose…
        </option>
        {opts.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (v.type === "multiline") {
    return (
      <textarea
        id={`wb-in-${v.name}`}
        className={`${baseClass} wb-input-multi`}
        value={val}
        placeholder={placeholder}
        rows={3}
        onChange={(e) => h.onChange(e.target.value)}
        onFocus={h.onFocus}
        onBlur={h.onBlur}
      />
    );
  }
  return (
    <input
      id={`wb-in-${v.name}`}
      type="text"
      className={baseClass}
      value={val}
      placeholder={placeholder}
      onChange={(e) => h.onChange(e.target.value)}
      onFocus={h.onFocus}
      onBlur={h.onBlur}
    />
  );
}
