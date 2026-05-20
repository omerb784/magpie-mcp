import type {
  ReferenceItem,
  References,
  VarSchema,
  VarSchemaItem,
} from "../send-template-utils";

// v0.9.3 Phase F · Q2 lock — `fullpage` mode dropped along with the
// `/compose/:id` route. Workbench renders as a drawer overlay only.
export type WorkbenchMode = "panel" | "narrow";

export type { VarSchemaItem, VarSchema };

export interface WorkbenchVisual {
  id: string;
  title: string;
  fmt: string;
  ver: number;
  // S7 P7.D (F12) — when available, the MiniThumb in the crumb renders
  // an <img>; otherwise it falls back to the colored format box.
  thumb_url?: string | null;
}

export interface CompareVisual {
  id: string;
  title: string;
  fmt: string;
  a: { ver: number };
  b: { ver: number };
  current: { ver: number };
}

export type VerSourceTone = "a" | "b" | "current" | "shown" | "neutral";

export interface VerSource {
  key: string;
  label: string;
  ver: number;
  tone?: VerSourceTone;
}

export interface WorkbenchTemplate {
  id: string;
  name: string;
  body: string;
  varSchema: VarSchemaItem[] | null;
  // S8 P2.C — `examples` field now holds References shape (col name kept
  // for back-compat with the server payload).
  examples: References | null;
  builtin: boolean;
  versionNum: number;
  // S7 P3.D — surface scope to UI so TemplateRow + Crumb can render
  // a matching chip. Both null = global (the default for any pre-S7 row).
  scopeProjectId?: string | null;
  scopeVisualId?: string | null;
}

export interface LintWarningV {
  rule: string;
  message: string;
  hint: string;
}

export interface VersionRow {
  versionNum: number;
  label: string;
  when?: string;
}

// S7 P3.D — scope chip on palette rows + template row. Builtins never carry
// a scope chip (the `built-in` badge takes the slot). `archived` surfaces
// when a visual-scoped template's visual is currently archived (Q6 lock —
// muted chip, not hidden).
export type PaletteScopeKind =
  | "global"
  | "project"
  | "visual"
  | "archived"
  | "builtin";

export interface PaletteScope {
  kind: PaletteScopeKind;
  label?: string;
}

export interface PaletteEntryT {
  id: string;
  name: string;
  desc: string;
  builtin: boolean;
  template: WorkbenchTemplate;
  scope?: PaletteScope;
}

export interface WorkbenchProps {
  visual: WorkbenchVisual | CompareVisual;
  compareMode?: boolean;
  template: WorkbenchTemplate | null;
  varValues?: Record<string, string>;
  verSources?: VerSource[];
  verSourceKey?: string;
  // S8 P2.C — references replace the legacy text-example slot.
  examples?: ReferenceItem[];
  lintWarnings?: LintWarningV[];
  mode?: WorkbenchMode;
  versionMenuOpen?: boolean;
  versionRows?: VersionRow[];
  cmdkOpen?: boolean;
  previewCollapsed?: boolean;
  examplesCollapsed?: boolean;
  lintStripExpanded?: boolean;
  activeVarPill?: string;
  showSavedDot?: boolean;
  freeBody?: string;
  paletteEntries?: PaletteEntryT[];
  onClose?: () => void;
  onSend?: () => void;
  onCopy?: () => void;
  onChangeFreeBody?: (value: string) => void;
  onToggleVersionMenu?: () => void;
  onPickVersion?: (versionNum: number) => void;
  onOpenPalette?: () => void;
  onClosePalette?: () => void;
  onPickPaletteEntry?: (entry: PaletteEntryT) => void;
  onChangeVar?: (name: string, value: string) => void;
  onFocusVar?: (name: string | undefined) => void;
  onPickVerSource?: (key: string) => void;
  onTogglePreview?: () => void;
  // S8 P2.C — toggle kept; payload now references not text examples.
  onToggleExamples?: () => void;
  onAddExample?: () => void;
  onChangeExample?: (idx: number, patch: Partial<ReferenceItem>) => void;
  onRemoveExample?: (idx: number) => void;
  onToggleLintStrip?: () => void;
}
