import { Icon } from "../Icon";
import type { PaletteScope, WorkbenchTemplate } from "./types";
import { ScopeChip } from "./ScopeChip";

interface TemplateRowProps {
  template: WorkbenchTemplate | null;
  exampleCount?: number;
  scope?: PaletteScope;
  onOpenPalette?: () => void;
}

export function TemplateRow({
  template,
  exampleCount = 0,
  scope,
  onOpenPalette,
}: TemplateRowProps) {
  if (!template) {
    return (
      <button
        type="button"
        className="wb-template-row wb-template-empty"
        onClick={onOpenPalette}
      >
        <span style={{ opacity: 0.6 }}>
          <Icon name="template" size={13} />
        </span>
        <span className="wb-template-name" style={{ color: "var(--text-mute)" }}>
          pick a template…
        </span>
        <span style={{ marginLeft: "auto" }} className="kbd">
          ⌘ K
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="wb-template-row"
      onClick={onOpenPalette}
    >
      <span style={{ color: "var(--accent)" }}>
        <Icon name="template" size={13} />
      </span>
      <span className="wb-template-name">{template.name}</span>
      {template.builtin ? (
        <span
          className="wb-mono-label"
          style={{
            color: "var(--accent)",
            background: "var(--accent-soft)",
            padding: "2px 8px",
            borderRadius: "var(--radius-xs)",
          }}
        >
          built-in
        </span>
      ) : (
        <span
          className="wb-mono-label"
          style={{ padding: "2px 8px" }}
        >
          saved · v{template.versionNum || 1}
        </span>
      )}
      {scope && scope.kind !== "builtin" && scope.kind !== "global" && (
        <ScopeChip scope={scope} />
      )}
      <span
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: "var(--s-2)",
          alignItems: "center",
        }}
      >
        <span className="wb-mono-label">
          refs {exampleCount}/3
        </span>
        <span className="kbd">⌘ K</span>
      </span>
    </button>
  );
}
