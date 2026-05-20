import { Icon } from "../Icon";
import {
  MAX_REFERENCES,
  type ReferenceItem,
} from "../send-template-utils";

// S8 P2.C — Examples.tsx is the legacy panel; P5 renames + rewrites it
// to References.tsx. Through the cut-over the file accepts ReferenceItem
// rows so types stay clean; it renders a placeholder header only. The
// real refs picker lives in the /templates Builder UI (P5).

interface ExamplesProps {
  examples: ReferenceItem[];
  collapsed: boolean;
  onToggle?: () => void;
  onAdd?: () => void;
  onChange?: (idx: number, patch: Partial<ReferenceItem>) => void;
  onRemove?: (idx: number) => void;
}

export function Examples({
  examples,
  collapsed,
  onToggle,
}: ExamplesProps) {
  const count = examples.length;
  return (
    <div className={`wb-examples ${collapsed ? "collapsed" : ""}`}>
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
          <span className="wb-mono-label">
            references · {count}/{MAX_REFERENCES}
          </span>
        </span>
      </div>
    </div>
  );
}
