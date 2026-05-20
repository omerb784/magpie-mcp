// S7 P3.D — small pill rendered next to template names in the ⌘K palette
// and on the template row. Variant comes from the scope kind so the
// dashboard colour palette stays consistent: project=accent · visual=terra
// · archived=muted italic · global=info-soft. Builtins never render a chip
// (the `built-in` badge already takes the slot).
import type { PaletteScope } from "./types";

interface ScopeChipProps {
  scope: PaletteScope;
}

const LABELS: Record<PaletteScope["kind"], string> = {
  global: "global",
  project: "project",
  visual: "visual",
  archived: "archived",
  builtin: "built-in",
};

export function ScopeChip({ scope }: ScopeChipProps) {
  if (scope.kind === "builtin") return null;
  return (
    <span className={`wb-scope-chip wb-scope-chip--${scope.kind}`}>
      {scope.label ?? LABELS[scope.kind]}
    </span>
  );
}
