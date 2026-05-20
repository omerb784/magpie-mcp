import { useCallback, useEffect, useMemo, useState } from "react";
import {
  interpolate,
  MAX_REFERENCES,
  resolveReferences,
  type ReferenceItem,
  type SendTemplate,
  type VisualForSend,
} from "./send-template-utils.js";
import { lintTemplate } from "./template-lint.js";
import { Workbench } from "./workbench/Workbench.js";
import type {
  PaletteEntryT,
  VerSource,
  VersionRow,
  WorkbenchMode,
  WorkbenchTemplate,
  WorkbenchVisual,
  CompareVisual,
} from "./workbench/types.js";
import {
  defaultsFor,
  formatWhen,
  paletteScopeFor,
  toWorkbenchTemplate,
} from "./workbench/host-helpers.js";
import {
  clearDraft,
  readDraft,
  useDraftPersistence,
} from "./workbench/useDraftPersistence.js";

export interface WorkbenchHostVisual {
  id: string;
  title: string;
  fmt: string;
  ver: number;
  thumb_url?: string | null;
}

export interface WorkbenchHostCompare {
  id: string;
  title: string;
  fmt: string;
  a: { ver: number };
  b: { ver: number };
  current: { ver: number };
}

export interface WorkbenchHostProps {
  visual: WorkbenchHostVisual | WorkbenchHostCompare;
  compareMode?: boolean;
  mode?: WorkbenchMode;
  /** Initial template seed. The host re-fetches with scope context (P3.B/C)
   *  using the visual's project id + visual id, so this prop is only the
   *  first-paint list — typically the cached dashboard list. Callers may
   *  pass `[]` if they don't have a list yet. */
  templates: SendTemplate[];
  /** S7 P3.B — project id for scope filter. When provided, the host appends
   *  `?project=<id>` to the GET so out-of-context scoped templates drop out
   *  and project-scoped rows rank between visual-scoped and global. */
  projectId?: string;
  verSources?: VerSource[];
  onClose: () => void;
  onCopy: (text: string) => void;
  onSendToInbox: (args: {
    body: string;
    template_id: string | null;
    template_version_num: number | null;
  }) => void | Promise<void>;
}

function isCompare(
  v: WorkbenchHostVisual | WorkbenchHostCompare,
): v is WorkbenchHostCompare {
  return (v as WorkbenchHostCompare).a !== undefined;
}

function toCrumbVisual(
  v: WorkbenchHostVisual | WorkbenchHostCompare,
  displayVer: number,
): WorkbenchVisual | CompareVisual {
  if (isCompare(v)) {
    return {
      id: v.id,
      title: v.title,
      fmt: v.fmt,
      a: v.a,
      b: v.b,
      current: v.current,
    };
  }
  return {
    id: v.id,
    title: v.title,
    fmt: v.fmt,
    ver: displayVer,
    thumb_url: v.thumb_url ?? null,
  };
}

function visualForInterp(
  v: WorkbenchHostVisual | WorkbenchHostCompare,
  resolvedVer: number,
): VisualForSend {
  return { id: v.id, title: v.title, current_ver: resolvedVer };
}

const BUILTIN_DESCS: Record<string, string> = {
  iterate: "make a refinement of this visual",
  variants: "generate several alternative directions",
  explain: "describe what the visual conveys",
  a11y_audit: "check accessibility against WCAG basics",
  responsive_check: "verify mobile/tablet/desktop behavior",
  dark_mode_port: "create a dark-mode variant",
  simplify: "remove non-essential elements",
  add_data: "extend with realistic data scenarios",
};

export function WorkbenchHost(props: WorkbenchHostProps) {
  const {
    visual,
    compareMode = false,
    mode: modeProp,
    templates: seededTemplates,
    projectId,
    verSources,
    onClose,
    onCopy,
    onSendToInbox,
  } = props;

  // S7 P3.B — keep the seed list as first-paint, then re-fetch scoped so
  // out-of-context templates drop and scope-nearest ordering applies.
  const [templates, setTemplates] = useState<SendTemplate[]>(seededTemplates);
  useEffect(() => {
    setTemplates(seededTemplates);
  }, [seededTemplates]);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (projectId) params.set("project", projectId);
    params.set("visual", visual.id);
    fetch(`/api/send-templates?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SendTemplate[] | null) => {
        if (cancelled || !Array.isArray(data)) return;
        setTemplates(data);
      })
      .catch(() => {
        // Network blip — keep the seeded list rather than blank the palette.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, visual.id]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [examples, setExamples] = useState<ReferenceItem[]>([]);
  const [versionRows, setVersionRows] = useState<VersionRow[]>([]);
  const [pickedVisualVer, setPickedVisualVer] = useState<number | null>(null);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [freeBody, setFreeBody] = useState<string>("");
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [examplesCollapsed, setExamplesCollapsed] = useState(true);
  const [lintStripExpanded, setLintStripExpanded] = useState(false);
  const [activeVarPill, setActiveVarPill] = useState<string | undefined>(
    undefined,
  );
  const [verSourceKey, setVerSourceKey] = useState<string>(
    () => verSources?.[0]?.key ?? "",
  );

  const [mode, setMode] = useState<WorkbenchMode>(modeProp ?? "panel");
  useEffect(() => {
    if (modeProp) setMode(modeProp);
  }, [modeProp]);
  useEffect(() => {
    if (modeProp) return;
    function onResize() {
      const w = window.innerWidth;
      setMode(w < 1100 ? "narrow" : "panel");
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [modeProp]);

  const baseTemplate = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const activeTemplate = useMemo<WorkbenchTemplate | null>(() => {
    if (!baseTemplate) return null;
    return toWorkbenchTemplate(baseTemplate);
  }, [baseTemplate]);

  const resolvedVer = useMemo(() => {
    if (pickedVisualVer != null) return pickedVisualVer;
    if (verSources && verSourceKey) {
      const src = verSources.find((s) => s.key === verSourceKey);
      if (src) return src.ver;
    }
    if (isCompare(visual)) return visual.current.ver;
    return visual.ver;
  }, [visual, verSources, verSourceKey, pickedVisualVer]);

  const interpVisual = useMemo(
    () => visualForInterp(visual, resolvedVer),
    [visual, resolvedVer],
  );

  useEffect(() => {
    if (!baseTemplate) {
      setVarValues({});
      setExamples([]);
      return;
    }
    const draft = readDraft(visual.id, baseTemplate.id);
    const schema = baseTemplate.var_schema ?? null;
    const defaults = defaultsFor(schema, baseTemplate.var_names);
    if (draft) {
      setVarValues({ ...defaults, ...draft.varValues });
      setExamples(draft.examples ?? []);
    } else {
      setVarValues(defaults);
      setExamples(baseTemplate.examples ?? []);
    }
  }, [baseTemplate, visual.id]);

  useEffect(() => {
    let cancelled = false;
    const currentVer = isCompare(visual) ? visual.current.ver : visual.ver;
    fetch(`/api/visuals/${visual.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { versions?: Array<{ version_num: number; created_at?: string }> } | null) => {
        if (cancelled || !data || !Array.isArray(data.versions)) return;
        setVersionRows(
          data.versions
            .slice()
            .sort((a, b) => b.version_num - a.version_num)
            .map((row) => ({
              versionNum: row.version_num,
              label: row.version_num === currentVer ? "current" : "",
              when: row.created_at ? formatWhen(row.created_at) : undefined,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setVersionRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visual]);

  useEffect(() => {
    setPickedVisualVer(null);
  }, [visual.id]);

  const paletteEntries = useMemo<PaletteEntryT[]>(() => {
    return templates
      .slice()
      .sort((a, b) => {
        if (a.is_builtin !== b.is_builtin) return a.is_builtin ? -1 : 1;
        return a.sort_order - b.sort_order;
      })
      .map((t) => {
        const wt = toWorkbenchTemplate(t);
        return {
          id: t.id,
          name: t.name,
          desc: t.is_builtin
            ? BUILTIN_DESCS[t.name] ?? "built-in preset"
            : "saved template",
          builtin: t.is_builtin,
          template: wt,
          scope: paletteScopeFor(wt),
        };
      });
  }, [templates]);

  const lintWarnings = useMemo(() => {
    if (!activeTemplate) return [];
    return lintTemplate({
      body: activeTemplate.body,
      varSchema: activeTemplate.varSchema,
      // S8 P8 — refs (template's saved references) drive the
      // `unreferenced_ref` rule. The host's live `examples` state
      // (in-flight edits) isn't lintable on the workbench since
      // refs are managed in the /templates Builder UI, not here.
      references: activeTemplate.examples,
    });
  }, [activeTemplate]);

  const draftState = useMemo(
    () => ({ varValues, examples }),
    [varValues, examples],
  );
  const { showSavedDot, flush } = useDraftPersistence({
    visualId: visual.id,
    templateId: baseTemplate ? baseTemplate.id : null,
    state: draftState,
  });

  const finalBody = useMemo(() => {
    if (activeTemplate) {
      // S8 P3.C — `{{refN}}` mustache vars resolve to magpie:// URIs.
      // resolveReferences returns body unchanged + a refMap that interpolate
      // honors before its values map; the LLM reads the URI via ReadResource.
      const { body, refMap } = resolveReferences(activeTemplate.body, examples);
      return interpolate(body, interpVisual, varValues, refMap);
    }
    return freeBody;
  }, [activeTemplate, examples, interpVisual, varValues, freeBody]);

  const handleSend = useCallback(async () => {
    if (!activeTemplate && freeBody.trim().length === 0) return;
    flush();
    await onSendToInbox({
      body: finalBody,
      template_id: baseTemplate?.id ?? null,
      template_version_num: activeTemplate?.versionNum ?? null,
    });
    if (baseTemplate) clearDraft(visual.id, baseTemplate.id);
    // S7 P6.C (F14) — clear the free-prompt textarea after a send completes
    // so re-sending an unrelated prompt doesn't ride on stale text. The
    // template path's draft is already wiped above; the free-prompt path
    // needs its state set explicitly because freeBody lives on the host.
    if (!activeTemplate) setFreeBody("");
  }, [
    activeTemplate,
    baseTemplate,
    finalBody,
    flush,
    freeBody,
    onSendToInbox,
    visual.id,
  ]);

  const handleCopy = useCallback(() => {
    if (!finalBody) return;
    onCopy(finalBody);
  }, [finalBody, onCopy]);

  const onPickPaletteEntry = useCallback((entry: PaletteEntryT) => {
    setSelectedId(entry.id);
  }, []);

  const onChangeVar = useCallback((name: string, value: string) => {
    setVarValues((cur) => ({ ...cur, [name]: value }));
  }, []);

  const onFocusVar = useCallback((name: string | undefined) => {
    setActiveVarPill(name);
  }, []);

  // S8 P2.C — references replace text examples. Builder UI lands at P5;
  // through P2-P4 the host keeps the callback shape but operates on
  // ReferenceItem rows (visual_id + visual_version) sourced from picker.
  const onAddExample = useCallback(() => {
    setExamples((cur) =>
      cur.length >= MAX_REFERENCES
        ? cur
        : [
            ...cur,
            {
              name: `ref${cur.length + 1}` as ReferenceItem["name"],
              visual_id: "",
              visual_version: null,
            },
          ],
    );
    setExamplesCollapsed(false);
  }, []);

  const onChangeExample = useCallback(
    (idx: number, patch: Partial<ReferenceItem>) => {
      setExamples((cur) =>
        cur.map((ex, i) => (i === idx ? { ...ex, ...patch } : ex)),
      );
    },
    [],
  );

  const onRemoveExample = useCallback((idx: number) => {
    setExamples((cur) => cur.filter((_, i) => i !== idx));
  }, []);

  const onPickVersion = useCallback(
    (versionNum: number) => {
      setVersionMenuOpen(false);
      const currentVer = isCompare(visual) ? visual.current.ver : visual.ver;
      setPickedVisualVer(versionNum === currentVer ? null : versionNum);
    },
    [visual],
  );

  return (
    <Workbench
      visual={toCrumbVisual(visual, resolvedVer)}
      compareMode={compareMode}
      mode={mode}
      template={activeTemplate}
      varValues={varValues}
      examples={examples}
      versionMenuOpen={versionMenuOpen}
      versionRows={versionRows}
      cmdkOpen={cmdkOpen}
      paletteEntries={paletteEntries}
      previewCollapsed={previewCollapsed}
      examplesCollapsed={examplesCollapsed}
      lintWarnings={lintWarnings}
      lintStripExpanded={lintStripExpanded}
      activeVarPill={activeVarPill}
      showSavedDot={showSavedDot}
      verSources={verSources}
      verSourceKey={verSourceKey}
      freeBody={freeBody}
      onClose={onClose}
      onSend={handleSend}
      onCopy={handleCopy}
      onToggleVersionMenu={() => setVersionMenuOpen((v) => !v)}
      onPickVersion={onPickVersion}
      onOpenPalette={() => setCmdkOpen(true)}
      onClosePalette={() => setCmdkOpen(false)}
      onPickPaletteEntry={onPickPaletteEntry}
      onChangeVar={onChangeVar}
      onChangeFreeBody={setFreeBody}
      onFocusVar={onFocusVar}
      onPickVerSource={(k) => setVerSourceKey(k)}
      onTogglePreview={() => setPreviewCollapsed((v) => !v)}
      onToggleExamples={() => setExamplesCollapsed((v) => !v)}
      onAddExample={onAddExample}
      onChangeExample={onChangeExample}
      onRemoveExample={onRemoveExample}
      onToggleLintStrip={() => setLintStripExpanded((v) => !v)}
    />
  );
}

export { Workbench };
