import { useMemo } from "react";
import {
  approxTokens,
  resolveReferences,
  splitInterpolation,
  type ReferenceItem,
} from "../send-template-utils";
import { Icon } from "../Icon";
import type {
  CompareVisual,
  WorkbenchTemplate,
  WorkbenchVisual,
} from "./types";

interface PreviewProps {
  template: WorkbenchTemplate | null;
  visual: WorkbenchVisual | CompareVisual;
  varValues: Record<string, string>;
  examples?: ReferenceItem[];
  collapsed: boolean;
  activeVarPill?: string;
  onToggle?: () => void;
}

function visualToSendForm(
  visual: WorkbenchVisual | CompareVisual,
): { id: string; title: string; current_ver: number } {
  if ("a" in visual) {
    return {
      id: visual.id,
      title: visual.title,
      current_ver: visual.current.ver,
    };
  }
  return {
    id: visual.id,
    title: visual.title,
    current_ver: visual.ver,
  };
}

export function Preview({
  template,
  visual,
  varValues,
  examples,
  collapsed,
  activeVarPill,
  onToggle,
}: PreviewProps) {
  if (!template) return null;
  const v = visualToSendForm(visual);
  const interpolated = useMemo(() => {
    // S8 P3.C — body unchanged; refMap drives `{{refN}}` → magpie:// URI.
    const { body, refMap } = resolveReferences(template.body, examples ?? null);
    return {
      segments: splitInterpolation(body, v, varValues, refMap),
      text: substituteInline(body, v, varValues, refMap),
    };
  }, [template.body, examples, v.id, v.title, v.current_ver, varValues]);

  return (
    <div className={`wb-preview ${collapsed ? "collapsed" : ""}`}>
      <div
        className="wb-section-head wb-section-head-toggle"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle?.();
          }
        }}
        aria-expanded={!collapsed}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--s-1)",
          }}
        >
          <span style={{ color: "var(--text-mute)" }}>
            <Icon
              name={collapsed ? "chevron-right" : "chevron-down"}
              size={11}
            />
          </span>
          <span className="wb-mono-label">preview · with substitutions</span>
        </span>
        <span style={{ marginLeft: "auto" }}>
          <span className="wb-mono-label">
            {approxTokens(interpolated.text)} tok ·{" "}
            {interpolated.text.length} chars
          </span>
        </span>
      </div>
      {!collapsed && (
        <pre className="wb-preview-pre">
          {interpolated.segments.map((seg, i) => {
            if (seg.kind === "text") {
              return <span key={i}>{seg.value}</span>;
            }
            const active = activeVarPill === seg.name;
            const classes = [
              "wb-varpill",
              seg.type === "system" ? "sys" : "",
              !seg.filled ? "empty" : "",
              active ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <span key={i} className={classes}>
                {seg.value}
              </span>
            );
          })}
        </pre>
      )}
    </div>
  );
}

function substituteInline(
  body: string,
  visual: { id: string; title: string; current_ver: number },
  values: Record<string, string>,
  refMap?: Record<string, string>,
): string {
  return body.replace(
    /\{\{([a-z][a-z0-9_]{0,15})\}\}/g,
    (_match, name: string) => {
      if (name === "id") return visual.id;
      if (name === "title") return visual.title || "untitled";
      if (name === "ver") return String(visual.current_ver);
      if (refMap && refMap[name] !== undefined) return refMap[name];
      const v = values[name];
      return v === undefined || v === "" ? `{{${name}}}` : v;
    },
  );
}
