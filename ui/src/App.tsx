import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, tagColor } from "./Icon.js";
import {
  DASHBOARD_EMPTY,
  projectEmpty,
  searchEmpty,
  ARCHIVED_PROJECTS_EMPTY,
  STARRED_EMPTY,
  EMPTY_STATE_COPY,
  KEYBOARD_HINTS,
  KEYBOARD_HINT_CMDK,
} from "./copy.js";
import { OutboxView } from "./OutboxView.js";
import { type SendTemplate } from "./send-template-utils.js";
import { TagPickerPopover } from "./TagPickerPopover.js";
import { WorkbenchHost } from "./WorkbenchHost.js";
import { autoCopyEnabled, clipboardCommandForInbox } from "./workbench/host-helpers.js";
import { pickInboxToastBody } from "./inbox-toast.js";

interface ProjectSummary {
  id: string;
  name: string;
  type: "mockup" | "diagram" | "mixed";
  description: string | null;
  visual_count: number;
  last_activity: string;
  archived_at: string | null;
}

interface VisualGridItem {
  id: string;
  project_id: string;
  title: string;
  type: "html" | "mermaid" | "svg" | "markdown" | "dot" | "vega-lite" | "d2";
  source: string | null;
  description: string | null;
  current_ver: number;
  starred: number;
  updated_at: string;
  archived_at: string | null;
  current_render_status: "pending" | "ok" | "warn" | "failed" | null;
  thumb_version: number | null;
  project_name: string;
  tag_names: string;
}

interface SearchHit {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  type: "html" | "mermaid" | "svg" | "markdown" | "dot" | "vega-lite" | "d2";
  current_ver: number;
  starred: number;
  updated_at: string;
  tag_names: string;
  current_render_status: "pending" | "ok" | "warn" | "failed" | null;
  thumb_version: number | null;
}

interface Version {
  id: string;
  visual_id: string;
  version_num: number;
  content_path: string;
  thumb_path: string | null;
  render_status: "pending" | "ok" | "warn" | "failed";
  render_error: string | null;
  message: string | null;
  description: string | null;
  created_at: string;
  bytes: number | null;
}

interface Tag {
  id: string;
  name: string;
  color: string | null;
}

interface TagAggregate {
  name: string;
  color: string | null;
  count: number;
}

interface LibraryCounts {
  all: number;
  starred: number;
  archived: number;
}

interface VisualDetail {
  visual: VisualGridItem;
  versions: Version[];
  tags: Tag[];
}

type WsEvent =
  | { kind: "visual.created"; visual_id: string }
  | { kind: "visual.updated"; visual_id: string }
  | { kind: "version.added"; visual_id: string; version_num: number }
  | { kind: "version.rendered"; visual_id: string; version_num: number; status: "ok" | "warn" | "failed"; thumb_path: string | null }
  | { kind: "mcp.connected" }
  | { kind: "mcp.disconnected" }
  | { kind: "inbox.added"; id: string }
  | { kind: "inbox.consumed"; ids: string[] }
  | { kind: "inbox.deleted"; id: string };

type ToastAction = { label: string; onClick: () => void | Promise<void> };
type ToastOpts = { action?: ToastAction; durationMs?: number; family?: string };
type Toast = {
  id: number;
  kind: "info" | "error" | "success";
  msg: string;
  label?: string;
  ttl: number;
  action?: ToastAction;
  family?: string;
};
type Theme = "light" | "dark";
type SidebarMode = "expanded" | "rail";
type ViewMode = "grid" | "list";

const STARRED_ID = "__starred__";
const ARCHIVED_ID = "__archived__";
const INBOX_ID = "__inbox__";
const SIDEBAR_CYCLE: Record<SidebarMode, SidebarMode> = {
  expanded: "rail",
  rail: "expanded",
};

const SOURCE_LABEL: Record<string, string> = {
  stitch: "Stitch",
  figma: "Figma",
  "mermaid-chart": "Mermaid Chart",
  svgmaker: "SVGMaker",
  icons8: "Icons8",
};

function fmtColorVar(type: string): string {
  return `var(--fmt-${type})`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function basename(p: string): string {
  if (!p) return "";
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : p;
}

interface EmptyStateProps {
  kind: "archived" | "starred" | "search";
  glyph: React.ReactNode;
  title: string;
  body: string;
  helper?: React.ReactNode;
  glyphAccent?: boolean;
}
function EmptyState({ kind, glyph, title, body, helper, glyphAccent }: EmptyStateProps) {
  const tag = EMPTY_STATE_COPY[kind].tag;
  return (
    <div className="empty-wrap">
      <div className="empty-card">
        <div className={`empty-glyph${glyphAccent ? " terra" : ""}`}>{glyph}</div>
        <div className="empty-tag">{tag}</div>
        <h2>{title}</h2>
        <p>{body}</p>
        {helper && <div className="empty-helper">{helper}</div>}
      </div>
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = (typeof localStorage !== "undefined" && localStorage.getItem("magpie.theme")) as Theme | null;
    return saved === "dark" || saved === "light" ? saved : "light";
  });
  useEffect(() => {
    document.body.dataset.theme = theme;
    try { localStorage.setItem("magpie.theme", theme); } catch { /* ignore */ }
    document.cookie = `magpie_theme=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  }, [theme]);

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("magpie.sidebar") : null;
    return saved === "rail" || saved === "expanded" ? saved : "expanded";
  });
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const peekTimeoutRef = useRef<number | null>(null);
  const [mcpStatus, setMcpStatus] = useState<"connected" | "disconnected">("disconnected");
  const onSidebarMouseEnter = () => {
    if (sidebarMode !== "rail") return;
    if (peekTimeoutRef.current) window.clearTimeout(peekTimeoutRef.current);
    setSidebarPeek(true);
  };
  const onSidebarMouseLeave = () => {
    if (peekTimeoutRef.current) window.clearTimeout(peekTimeoutRef.current);
    peekTimeoutRef.current = window.setTimeout(() => setSidebarPeek(false), 80);
  };
  useEffect(() => {
    if (sidebarMode !== "rail" && sidebarPeek) setSidebarPeek(false);
  }, [sidebarMode, sidebarPeek]);
  useEffect(() => {
    try { localStorage.setItem("magpie.sidebar", sidebarMode); } catch { /* ignore */ }
  }, [sidebarMode]);
  const cycleSidebar = useCallback(() => {
    setSidebarMode((m) => SIDEBAR_CYCLE[m]);
  }, []);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("magpie.viewMode") : null;
    return saved === "list" ? "list" : "grid";
  });
  useEffect(() => {
    try { localStorage.setItem("magpie.viewMode", viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [archivedProjects, setArchivedProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [visuals, setVisuals] = useState<VisualGridItem[]>([]);
  const [archivedVisuals, setArchivedVisuals] = useState<VisualGridItem[]>([]);
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VisualDetail | null>(null);

  const [showArchived, setShowArchived] = useState(false);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);

  const [activeTags, setActiveTags] = useState<string[]>([]);

  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagPickerPos, setTagPickerPos] = useState<{ top: number; left: number } | null>(null);

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState<string | null>(null);
  const [claudeMenuOpen, setClaudeMenuOpen] = useState(false);

  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloadMenuPos, setDownloadMenuPos] = useState<{ top: number; right: number } | null>(null);
  const downloadBtnRef = useRef<HTMLButtonElement | null>(null);
  const [downloadVer, setDownloadVer] = useState<number | null>(null);

  const [exportZipFor, setExportZipFor] = useState<{ name: string } | null>(null);
  const [exportZipMode, setExportZipMode] = useState<"current" | "all">("current");

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [expandedVersionDescs, setExpandedVersionDescs] = useState<Set<string>>(new Set());

  const [projectMenu, setProjectMenu] = useState<{ pid: string; name: string; x: number; y: number } | null>(null);
  const [renamingProject, setRenamingProject] = useState<{ pid: string; value: string } | null>(null);
  const [mergeModal, setMergeModal] = useState<{ srcName: string } | null>(null);

  type ConfirmSpec = {
    title: string;
    body?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    resolve: (ok: boolean) => void;
  };
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);
  const confirmModal = useCallback(
    (spec: Omit<ConfirmSpec, "resolve">): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setConfirmSpec({ ...spec, resolve });
      }),
    []
  );

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [showReconnectBanner, setShowReconnectBanner] = useState(false);
  const [markTilt, setMarkTilt] = useState(false);
  useEffect(() => {
    setMarkTilt(true);
    const t = setTimeout(() => setMarkTilt(false), 800);
    return () => clearTimeout(t);
  }, []);

  const [springingStarId, setSpringingStarId] = useState<string | null>(null);
  const springTimeoutRef = useRef<number | null>(null);
  const triggerStarSpring = (id: string) => {
    if (springTimeoutRef.current) window.clearTimeout(springTimeoutRef.current);
    setSpringingStarId(id);
    springTimeoutRef.current = window.setTimeout(() => setSpringingStarId(null), 280);
  };

  const [leavingChips, setLeavingChips] = useState<Set<string>>(new Set());
  const removeChipWithBleed = (id: string, commit: () => void) => {
    setLeavingChips((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      commit();
      setLeavingChips((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 180);
  };

  type EmptyConfig =
    | { kind: "loading" }
    | { kind: "ok"; code: string; desktop: string }
    | { kind: "error" };
  const [emptyConfig, setEmptyConfig] = useState<EmptyConfig>({ kind: "loading" });
  const [emptyConfigTab, setEmptyConfigTab] = useState<"code" | "desktop">("code");
  const [seedLoading, setSeedLoading] = useState(false);
  const [showCheatsheet, setShowCheatsheet] = useState(false);

  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [pulseIds, setPulseIds] = useState<string[]>([]);
  const [heroPulseId, setHeroPulseId] = useState<string | null>(null);
  const [archivedFilter, setArchivedFilter] = useState("");

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const [cmdKDropped, setCmdKDropped] = useState(false);

  const [tagAggregates, setTagAggregates] = useState<TagAggregate[]>([]);
  const [libraryCounts, setLibraryCounts] = useState<LibraryCounts>({ all: 0, starred: 0, archived: 0 });

  const [sendTemplates, setSendTemplates] = useState<SendTemplate[]>([]);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  const pushToast = useCallback(
    (kind: Toast["kind"], msg: string, label?: string, opts?: ToastOpts) => {
      const id = Date.now() + Math.random();
      const ttl =
        opts?.durationMs ??
        (opts?.action ? 5000 : kind === "error" ? 10000 : 5000);
      setToasts((t) => {
        const filtered = opts?.family ? t.filter((x) => x.family !== opts.family) : t;
        return [...filtered, { id, kind, msg, label, ttl, action: opts?.action, family: opts?.family }];
      });
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const refreshSendTemplates = useCallback(() => {
    fetch("/api/send-templates")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((list: SendTemplate[]) => setSendTemplates(list))
      .catch(() => setSendTemplates([]));
  }, []);

  const refreshProjects = useCallback(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((p: ProjectSummary[]) => {
        setProjects(p);
        setSelectedProjectId((cur) => {
          if (cur === STARRED_ID || cur === ARCHIVED_ID) return cur;
          if (cur && p.some((x) => x.id === cur)) return cur;
          return p[0]?.id ?? null;
        });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const refreshArchivedProjects = useCallback(() => {
    fetch("/api/projects?archived=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setArchivedProjects)
      .catch(() => setArchivedProjects([]));
  }, []);

  const refreshVisuals = useCallback((pid: string) => {
    fetch(`/api/projects/${pid}/visuals`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setVisuals)
      .catch((e: Error) => setError(e.message));
  }, []);

  const refreshArchivedVisuals = useCallback((pid: string) => {
    fetch(`/api/projects/${pid}/visuals?archived=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setArchivedVisuals)
      .catch(() => setArchivedVisuals([]));
  }, []);

  const refreshAllVisuals = useCallback(() => {
    fetch("/api/visuals")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setVisuals)
      .catch((e: Error) => setError(e.message));
  }, []);

  const refreshStarred = useCallback(() => {
    fetch("/api/search?starred=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows: SearchHit[]) => {
        const mapped: VisualGridItem[] = rows.map((r) => ({
          id: r.id,
          project_id: r.project_id,
          title: r.title,
          type: r.type,
          source: null,
          current_ver: r.current_ver,
          starred: r.starred,
          updated_at: r.updated_at,
          archived_at: null,
          current_render_status: r.current_render_status ?? "ok",
          thumb_version: r.thumb_version,
          project_name: r.project_name,
          tag_names: r.tag_names,
        }));
        setVisuals(mapped);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const refreshDetail = useCallback((vid: string) => {
    fetch(`/api/visuals/${vid}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, []);

  const refetchSearchFromView = useCallback((v: {
    debouncedQuery: string;
    activeTags: string[];
    selectedProjectId: string | null;
    selectedProjectName: string | null;
  }) => {
    const params = new URLSearchParams();
    if (v.debouncedQuery) params.set("q", v.debouncedQuery);
    for (const t of v.activeTags) params.append("tag", t);
    if (v.selectedProjectId === STARRED_ID) {
      params.set("starred", "1");
    } else if (v.selectedProjectName) {
      params.set("project", v.selectedProjectName);
    }
    if ([...params.keys()].length === 0) return;
    fetch(`/api/search?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows: SearchHit[]) => setSearchResults(rows))
      .catch(() => undefined);
  }, []);

  const refreshAggregates = useCallback(() => {
    fetch("/api/tags")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows: TagAggregate[]) => setTagAggregates(rows))
      .catch(() => setTagAggregates([]));
    fetch("/api/library-counts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((c: LibraryCounts) => setLibraryCounts(c))
      .catch(() => undefined);
  }, []);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);
  useEffect(() => { refreshSendTemplates(); }, [refreshSendTemplates]);

  useEffect(() => {
    refreshArchivedProjects();
  }, [refreshArchivedProjects]);

  useEffect(() => { refreshAggregates(); }, [refreshAggregates]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const visualParam = params.get("visual");
    if (!visualParam) return;
    let cancelled = false;
    fetch(`/api/visuals/${encodeURIComponent(visualParam)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { visual: { id: string; project_id: string } }) => {
        if (cancelled) return;
        setSelectedProjectId(d.visual.project_id);
        setSelectedVisualId(d.visual.id);
        window.history.replaceState({}, "", window.location.pathname);
      })
      .catch(() => {
        if (cancelled) return;
        pushToast("error", `Visual ${visualParam} not found`, "Deep link");
        window.history.replaceState({}, "", window.location.pathname);
      });
    return () => {
      cancelled = true;
    };
  }, [pushToast]);

  useEffect(() => {
    if (!selectedProjectId) {
      refreshAllVisuals();
      setArchivedVisuals([]);
      return;
    }
    if (selectedProjectId === STARRED_ID) {
      refreshStarred();
      setArchivedVisuals([]);
      return;
    }
    if (selectedProjectId === ARCHIVED_ID) {
      setVisuals([]);
      setArchivedVisuals([]);
      return;
    }
    refreshVisuals(selectedProjectId);
    if (showArchived) refreshArchivedVisuals(selectedProjectId);
    else setArchivedVisuals([]);
  }, [selectedProjectId, showArchived, refreshVisuals, refreshArchivedVisuals, refreshStarred, refreshAllVisuals]);

  useEffect(() => {
    if (selectedProjectId !== ARCHIVED_ID) setShowArchived(false);
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedVisualId) refreshDetail(selectedVisualId);
    else setDetail(null);
    setShowTagInput(false);
    setTagInput("");
    setConfirmArchive(false);
    setTitleDraft(null);
    setDescDraft(null);
    setClaudeMenuOpen(false);
  }, [selectedVisualId, refreshDetail]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const buildSearchParams = useCallback((): URLSearchParams | null => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set("q", debouncedQuery);
    for (const t of activeTags) params.append("tag", t);
    if (selectedProjectId === STARRED_ID) {
      params.set("starred", "1");
    } else if (selectedProjectId && selectedProjectId !== ARCHIVED_ID) {
      const name = projects?.find((proj) => proj.id === selectedProjectId)?.name;
      if (name) params.set("project", name);
    }
    if ([...params.keys()].length === 0) return null;
    return params;
  }, [debouncedQuery, activeTags, selectedProjectId, projects]);

  useEffect(() => {
    const params = buildSearchParams();
    if (!params) {
      setSearchResults(null);
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/search?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows: SearchHit[]) => setSearchResults(rows))
      .catch((e: Error) => { if (e.name !== "AbortError") setSearchResults([]); });
    return () => ctrl.abort();
  }, [buildSearchParams]);

  const loadEmptyConfig = useCallback(() => {
    setEmptyConfig({ kind: "loading" });
    Promise.all([
      fetch("/api/config-snippet?host=code").then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetch("/api/config-snippet?host=desktop").then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    ])
      .then(([code, desktop]) => setEmptyConfig({ kind: "ok", code, desktop }))
      .catch(() => {
        setEmptyConfig({ kind: "error" });
        pushToast("error", "Couldn't load config snippet — try reloading");
      });
  }, [pushToast]);

  useEffect(() => {
    if (projects && projects.length === 0 && emptyConfig.kind === "loading") {
      loadEmptyConfig();
    }
  }, [projects, emptyConfig, loadEmptyConfig]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectBannerTimerRef = useRef<number | null>(null);
  const lastCanonicalPidRef = useRef<number | null>(null);
  const lastSelectedProjectName: string | null =
    selectedProjectId && selectedProjectId !== STARRED_ID && selectedProjectId !== ARCHIVED_ID
      ? projects?.find((proj) => proj.id === selectedProjectId)?.name ?? null
      : null;
  const lastViewRefRef = useRef<{
    selectedProjectId: string | null;
    selectedProjectName: string | null;
    selectedVisualId: string | null;
    showArchived: boolean;
    debouncedQuery: string;
    activeTags: string[];
  }>({ selectedProjectId, selectedProjectName: lastSelectedProjectName, selectedVisualId, showArchived, debouncedQuery, activeTags });
  lastViewRefRef.current = { selectedProjectId, selectedProjectName: lastSelectedProjectName, selectedVisualId, showArchived, debouncedQuery, activeTags };

  useEffect(() => {
    let cancelled = false;
    function connect() {
      if (cancelled) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        setWsConnected(true);
        if (reconnectBannerTimerRef.current) {
          window.clearTimeout(reconnectBannerTimerRef.current);
          reconnectBannerTimerRef.current = null;
        }
        setShowReconnectBanner(false);
        const v = lastViewRefRef.current;
        refreshProjects();
        refreshAggregates();
        if (v.selectedProjectId === STARRED_ID) refreshStarred();
        else if (v.selectedProjectId === null) refreshAllVisuals();
        else if (v.selectedProjectId !== ARCHIVED_ID) refreshVisuals(v.selectedProjectId);
        if (v.selectedVisualId) refreshDetail(v.selectedVisualId);
        // Detect canonical promotion (R19 Path 2 lifecycle). Fetch identity;
        // if pid differs from last cached value AND we already had a cached
        // value (i.e. this isn't the first connect), toast that Magpie was
        // promoted underneath the user.
        void (async () => {
          try {
            const resp = await fetch("/api/canonical-info");
            if (!resp.ok) return;
            const info = (await resp.json()) as { pid?: number };
            const newPid = typeof info?.pid === "number" ? info.pid : null;
            if (newPid === null) return;
            const previousPid = lastCanonicalPidRef.current;
            if (previousPid !== null && previousPid !== newPid) {
              pushToast(
                "info",
                "Magpie reconnected",
                "Canonical promoted · pid changed",
                { family: "canonical-reconnect" },
              );
            }
            lastCanonicalPidRef.current = newPid;
          } catch {
            /* network error — non-fatal; next reconnect will retry */
          }
        })();
      };
      ws.onmessage = (ev) => {
        let msg: WsEvent;
        try { msg = JSON.parse(ev.data) as WsEvent; } catch { return; }
        const v = lastViewRefRef.current;
        if (msg.kind === "visual.created") {
          refreshProjects();
          refreshAggregates();
          if (v.selectedProjectId === STARRED_ID) refreshStarred();
          else if (v.selectedProjectId === null) refreshAllVisuals();
          else if (v.selectedProjectId !== ARCHIVED_ID) refreshVisuals(v.selectedProjectId);
          refetchSearchFromView(v);
          setFreshIds((f) => [...f, msg.visual_id]);
          setTimeout(() => setFreshIds((f) => f.filter((x) => x !== msg.visual_id)), 800);
          pushToast("info", "New visual saved", "Claude · just now");
        } else if (msg.kind === "visual.updated") {
          refreshProjects();
          refreshAggregates();
          if (v.selectedProjectId === STARRED_ID) refreshStarred();
          else if (v.selectedProjectId === null) refreshAllVisuals();
          else if (v.selectedProjectId !== ARCHIVED_ID) refreshVisuals(v.selectedProjectId);
          refreshArchivedProjects();
          if (v.showArchived && v.selectedProjectId && v.selectedProjectId !== STARRED_ID && v.selectedProjectId !== ARCHIVED_ID) {
            refreshArchivedVisuals(v.selectedProjectId);
          }
          refetchSearchFromView(v);
          if (v.selectedVisualId === msg.visual_id) refreshDetail(msg.visual_id);
          setPulseIds((p) => (p.includes(msg.visual_id) ? p : [...p, msg.visual_id]));
          setTimeout(
            () => setPulseIds((p) => p.filter((x) => x !== msg.visual_id)),
            700
          );
        } else if (msg.kind === "mcp.connected") {
          setMcpStatus("connected");
        } else if (msg.kind === "mcp.disconnected") {
          setMcpStatus("disconnected");
        } else if (
          msg.kind === "inbox.added" ||
          msg.kind === "inbox.consumed" ||
          msg.kind === "inbox.deleted"
        ) {
          setInboxRefreshKey((k) => k + 1);
        } else if (msg.kind === "version.added" || msg.kind === "version.rendered") {
          if (v.selectedProjectId === null) {
            refreshAllVisuals();
          } else if (v.selectedProjectId === STARRED_ID) {
            refreshStarred();
          } else if (v.selectedProjectId !== ARCHIVED_ID) {
            refreshVisuals(v.selectedProjectId);
          }
          if (v.selectedVisualId === msg.visual_id) refreshDetail(msg.visual_id);
          setFreshIds((f) => (f.includes(msg.visual_id) ? f : [...f, msg.visual_id]));
          setTimeout(
            () => setFreshIds((f) => f.filter((x) => x !== msg.visual_id)),
            800
          );
          if (msg.kind === "version.added") {
            pushToast("info", `Saved v${msg.version_num}`, "Iterate · just now");
            if (v.selectedVisualId === msg.visual_id) {
              setHeroPulseId(msg.visual_id);
              setTimeout(() => setHeroPulseId((cur) => (cur === msg.visual_id ? null : cur)), 700);
            }
          }
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!reconnectBannerTimerRef.current) {
          reconnectBannerTimerRef.current = window.setTimeout(() => setShowReconnectBanner(true), 2000);
        }
        if (!cancelled) reconnectTimerRef.current = window.setTimeout(connect, 1500);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    }
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (reconnectBannerTimerRef.current) window.clearTimeout(reconnectBannerTimerRef.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [refreshProjects, refreshStarred, refreshVisuals, refreshDetail, refreshArchivedProjects, refreshArchivedVisuals, refreshAggregates, refreshAllVisuals, refetchSearchFromView, pushToast]);

  useEffect(() => {
    if (!projectMenu) return;
    const close = () => setProjectMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [projectMenu]);

  const kbdRef = useRef<{
    query: string;
    selectedVisualId: string | null;
    focusedCardId: string | null;
    claudeMenuOpen: boolean;
    downloadMenuOpen: boolean;
    projectMenu: typeof projectMenu;
    mergeModal: typeof mergeModal;
    exportZipFor: typeof exportZipFor;
    confirmArchive: boolean;
    titleDraft: string | null;
    showTagInput: boolean;
    gridIds: string[];
    starredFor: (id: string) => boolean;
    patch: (id: string, body: { title?: string; tags?: string[]; starred?: boolean }) => void;
    setQuery: typeof setQuery;
    setSelectedVisualId: typeof setSelectedVisualId;
    setFocusedCardId: typeof setFocusedCardId;
    setClaudeMenuOpen: typeof setClaudeMenuOpen;
    setDownloadMenuOpen: typeof setDownloadMenuOpen;
    setProjectMenu: typeof setProjectMenu;
    setMergeModal: typeof setMergeModal;
    setExportZipFor: typeof setExportZipFor;
    setConfirmArchive: typeof setConfirmArchive;
    setTitleDraft: typeof setTitleDraft;
    setShowTagInput: typeof setShowTagInput;
    setCmdKDropped: typeof setCmdKDropped;
    showCheatsheet: boolean;
    setShowCheatsheet: typeof setShowCheatsheet;
    confirmSpecOpen: boolean;
    setConfirmSpec: typeof setConfirmSpec;
    copyFallback: string | null;
    setCopyFallback: typeof setCopyFallback;
    cycleSidebar: () => void;
    clearAllFilters: () => void;
  } | null>(null);

  useEffect(() => {
    if (!downloadMenuOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".download-anchor") || t?.closest(".download-menu")) return;
      setDownloadMenuOpen(false);
    };
    const reposition = () => {
      const r = downloadBtnRef.current?.getBoundingClientRect();
      if (!r) return;
      setDownloadMenuPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    reposition();
    window.addEventListener("click", close);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [downloadMenuOpen]);

  const selectedProject = useMemo(() => {
    if (selectedProjectId === STARRED_ID || selectedProjectId === ARCHIVED_ID) return null;
    return projects?.find((p) => p.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const isSearching = debouncedQuery.length > 0 || activeTags.length > 0;
  const isStarredView = selectedProjectId === STARRED_ID;
  const isArchivedView = selectedProjectId === ARCHIVED_ID;
  const isInboxView = selectedProjectId === INBOX_ID;
  const [inboxRefreshKey, setInboxRefreshKey] = useState(0);
  const [inboxPendingCount, setInboxPendingCount] = useState(0);

  useEffect(() => {
    fetch("/api/inbox?status=pending")
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((data: { entries: unknown[] }) => setInboxPendingCount(data.entries?.length ?? 0))
      .catch(() => setInboxPendingCount(0));
  }, [inboxRefreshKey]);

  const tagColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tagAggregates) if (t.color) m.set(t.name, t.color);
    return m;
  }, [tagAggregates]);

  const colorForTag = useCallback(
    (name: string) => tagColorMap.get(name) ?? tagColor(name),
    [tagColorMap]
  );

  const patchVisual = useCallback(
    async (
      id: string,
      body: { title?: string; description?: string | null; tags?: string[]; starred?: boolean }
    ) => {
      let snapshot: { visuals: VisualGridItem[]; archived: VisualGridItem[]; search: SearchHit[] | null } | null = null;
      if (body.starred !== undefined) {
        const next = body.starred ? 1 : 0;
        const flipGrid = (arr: VisualGridItem[]) =>
          arr.map((v) => (v.id === id ? { ...v, starred: next } : v));
        const flipSearch = (arr: SearchHit[] | null) =>
          arr ? arr.map((v) => (v.id === id ? { ...v, starred: next } : v)) : arr;
        setVisuals((prev) => {
          if (!snapshot) snapshot = { visuals: prev, archived: archivedVisuals, search: searchResults };
          return flipGrid(prev);
        });
        setArchivedVisuals((prev) => flipGrid(prev));
        setSearchResults((prev) => flipSearch(prev));
      }
      try {
        const r = await fetch(`/api/visuals/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        if (snapshot) {
          const s = snapshot as { visuals: VisualGridItem[]; archived: VisualGridItem[]; search: SearchHit[] | null };
          setVisuals(s.visuals);
          setArchivedVisuals(s.archived);
          setSearchResults(s.search);
        }
        pushToast("error", `Update failed: ${(e as Error).message}`);
      }
    },
    [archivedVisuals, searchResults, pushToast]
  );

  const archiveCurrentVisual = useCallback(async () => {
    if (!detail) return;
    const target = { id: detail.visual.id, title: detail.visual.title };
    try {
      const r = await fetch(`/api/visuals/${target.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSelectedVisualId(null);
      pushToast("success", `Archived "${target.title}"`, undefined, {
        family: `archive-visual-${target.id}`,
        action: {
          label: "Undo",
          onClick: async () => {
            const r2 = await fetch(`/api/visuals/${target.id}/restore`, { method: "POST" });
            if (!r2.ok) {
              pushToast("error", "Undo failed");
              return;
            }
            pushToast("info", `Restored "${target.title}"`, undefined, {
              family: `archive-visual-${target.id}`,
            });
          },
        },
      });
    } catch (e) {
      pushToast("error", `Archive failed: ${(e as Error).message}`);
    }
  }, [detail, pushToast]);

  const restoreVisual = useCallback(
    async (id: string) => {
      try {
        const r = await fetch(`/api/visuals/${id}/restore`, { method: "POST" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        pushToast("success", "Restored");
      } catch (e) {
        pushToast("error", `Restore failed: ${(e as Error).message}`);
      }
    },
    [pushToast]
  );

  const copyPromptText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        pushToast("info", "Prompt copied — paste into agent.", "Talk with agent");
        setClaudeMenuOpen(false);
      } catch {
        setCopyFallback(text);
      }
    },
    [pushToast]
  );

  const sendPromptToInbox = useCallback(
    async (args: {
      visual_id: string;
      body: string;
      template_id: string | null;
      template_version_num: number | null;
    }) => {
      try {
        const r = await fetch("/api/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visual_id: args.visual_id,
            template_id: args.template_id ?? undefined,
            template_version_num: args.template_version_num ?? undefined,
            prompt_body: args.body,
          }),
        });
        const data = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!r.ok) {
          pushToast("error", `Send failed: ${data.error ?? r.status}`);
          return;
        }
        const entryId = data.id;
        // S7 P6.A + P6.D — warm-handoff auto-copy. Default-on per Q5 lock;
        // localStorage `magpie.workbench.auto-copy = "off"` disables it.
        // Clipboard write is best-effort: some browsers reject without a
        // user gesture or in iframes; failures stay silent so they don't
        // surface to the user — the toast still confirms send success.
        if (entryId && autoCopyEnabled(typeof window !== "undefined" ? window.localStorage : null)) {
          try {
            await navigator.clipboard.writeText(clipboardCommandForInbox(entryId));
          } catch {
            /* clipboard rejection — silent */
          }
        }
        const undoAction = entryId
          ? {
              label: "Undo",
              onClick: async () => {
                const r2 = await fetch(`/api/inbox/${entryId}`, { method: "DELETE" });
                if (!r2.ok) {
                  const eb = (await r2.json().catch(() => ({}))) as { error?: string };
                  pushToast(
                    "error",
                    eb.error === "already_consumed"
                      ? "Cannot undo — agent already picked it up"
                      : "Undo failed"
                  );
                  return;
                }
                pushToast("info", "Send undone — entry removed from inbox.", "Inbox");
              },
            }
          : undefined;
        // v0.9.3 Phase E / T2 — MCP-aware variant. If the live indicator says
        // a host is connected, the agent will pick up the inbox entry on its
        // next turn; otherwise the user has to paste the prompt themselves.
        const toastBody = pickInboxToastBody(mcpStatus === "connected");
        pushToast("success", toastBody, "Talk with agent", {
          action: undoAction,
          family: "inbox-send",
        });
        setClaudeMenuOpen(false);
      } catch (e) {
        pushToast("error", `Send failed: ${(e as Error).message}`);
      }
    },
    [pushToast, mcpStatus]
  );

  const reRenderVersion = useCallback(
    async (vid: string, n: number, prevError?: string | null) => {
      try {
        const r = await fetch(`/api/visuals/${vid}/versions/${n}/render`, { method: "POST" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const msg = prevError
          ? `Re-rendering v${n} — previous error: ${prevError}`
          : `Re-rendering v${n}…`;
        pushToast("info", msg);
      } catch (e) {
        pushToast("error", `Re-render failed: ${(e as Error).message}`);
      }
    },
    [pushToast]
  );

  const revertToVersion = useCallback(
    async (vid: string, n: number) => {
      const snapshot = detail;
      const previousVer = snapshot?.visual.current_ver;
      if (snapshot && snapshot.visual.id === vid) {
        setDetail({ ...snapshot, visual: { ...snapshot.visual, current_ver: n } });
      }
      try {
        const r = await fetch(`/api/visuals/${vid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ current_ver: n }),
        });
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        const undoAction =
          previousVer && previousVer !== n
            ? {
                label: "Undo",
                onClick: async () => {
                  const r2 = await fetch(`/api/visuals/${vid}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ current_ver: previousVer }),
                  });
                  if (!r2.ok) {
                    pushToast("error", "Undo failed");
                    return;
                  }
                  pushToast("info", `Restored to v${previousVer}`, "Version");
                },
              }
            : undefined;
        pushToast("success", `Reverted to v${n}`, "Version", {
          action: undoAction,
          family: `revert-${vid}`,
        });
      } catch (e) {
        if (snapshot) setDetail(snapshot);
        pushToast("error", `Revert failed: ${(e as Error).message}`);
      }
    },
    [detail, pushToast]
  );

  const renameProj = useCallback(
    async (oldName: string, newName: string) => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(oldName)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        pushToast("success", `Renamed to "${newName}"`);
        refreshProjects();
      } catch (e) {
        pushToast("error", `Rename failed: ${(e as Error).message}`);
      }
    },
    [pushToast, refreshProjects]
  );

  const archiveProj = useCallback(
    async (pid: string, name: string) => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        refreshProjects();
        refreshArchivedProjects();
        setSelectedProjectId((cur) => (cur === pid ? null : cur));
        pushToast("success", `Archived project "${name}"`, undefined, {
          family: `archive-project-${pid}`,
          action: {
            label: "Undo",
            onClick: async () => {
              const r2 = await fetch(
                `/api/projects/${encodeURIComponent(name)}/restore`,
                { method: "POST" }
              );
              if (!r2.ok) {
                pushToast("error", "Undo failed");
                return;
              }
              refreshProjects();
              refreshArchivedProjects();
              pushToast("info", `Restored "${name}"`, undefined, {
                family: `archive-project-${pid}`,
              });
            },
          },
        });
      } catch (e) {
        pushToast("error", `Archive failed: ${(e as Error).message}`);
      }
    },
    [pushToast, refreshProjects, refreshArchivedProjects]
  );

  const restoreProj = useCallback(
    async (name: string) => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(name)}/restore`, { method: "POST" });
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        pushToast("success", `Restored "${name}"`);
        refreshProjects();
        refreshArchivedProjects();
      } catch (e) {
        pushToast("error", `Restore failed: ${(e as Error).message}`);
      }
    },
    [pushToast, refreshProjects, refreshArchivedProjects]
  );

  const mergeProj = useCallback(
    async (src: string, dst: string) => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(src)}/merge-into/${encodeURIComponent(dst)}`, { method: "POST" });
        const body = (await r.json().catch(() => ({}))) as { error?: string; moved?: number };
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        pushToast("success", `Merged ${body.moved ?? 0} visuals into "${dst}"`);
        refreshProjects();
      } catch (e) {
        pushToast("error", `Merge failed: ${(e as Error).message}`);
      }
    },
    [pushToast, refreshProjects]
  );

  const sectionTitle = isStarredView
    ? "Starred"
    : isArchivedView
      ? "Archived projects"
      : selectedProjectId === null
        ? "All visuals"
        : selectedProject?.name ?? "—";
  const sectionSub = isSearching
    ? `${searchResults?.length ?? "…"} match${(searchResults?.length ?? 0) === 1 ? "" : "es"}${debouncedQuery ? ` for "${debouncedQuery}"` : ""}`
    : isStarredView
      ? `${visuals.length} starred · across all projects`
      : isArchivedView
        ? `${archivedProjects.length} archived projects`
        : selectedProjectId === null
          ? `${visuals.length} visual${visuals.length === 1 ? "" : "s"} · across all projects`
          : selectedProject
            ? `${visuals.length} visual${visuals.length === 1 ? "" : "s"} · last activity ${relativeTime(selectedProject.last_activity)}`
            : "";

  interface RowSource {
    id: string;
    title: string;
    type: VisualGridItem["type"];
    current_ver: number;
    current_render_status: "pending" | "ok" | "warn" | "failed" | null;
    thumb_version: number | null;
    starred: number;
    updated_at: string;
    project_name: string;
    tag_names: string;
  }

  function renderRow(v: RowSource, opts: { archived?: boolean } = {}) {
    const isSelected = v.id === selectedVisualId;
    const isFresh = freshIds.includes(v.id);
    const isPulsing = pulseIds.includes(v.id);
    const isKFocus = focusedCardId === v.id;
    const tagList = v.tag_names ? v.tag_names.split(",").filter(Boolean) : [];
    const visibleTags = tagList.slice(0, 2);
    const overflow = tagList.length - visibleTags.length;
    return (
      <div
        key={v.id}
        ref={(el) => {
          if (el) cardRefs.current.set(v.id, el);
          else cardRefs.current.delete(v.id);
        }}
        data-kfocus={isKFocus ? "true" : undefined}
        className={`row${isSelected ? " selected" : ""}${isFresh ? " fresh" : ""}${isPulsing ? " pulse" : ""}${isKFocus ? " kfocus" : ""}`}
        onClick={() => setSelectedVisualId(v.id)}
        onDoubleClick={() => window.open(`/v/${v.id}`, "_blank", "noopener")}
        onMouseEnter={() => setFocusedCardId(v.id)}
      >
        <div className="row-thumb" style={{ "--fmt-color": fmtColorVar(v.type) } as React.CSSProperties}>
          {v.current_render_status === "ok" && v.thumb_version != null ? (
            <img src={`/thumbs/${v.id}/v${v.thumb_version}.png`} alt="" />
          ) : v.current_render_status === "failed" ? (
            <span className="placeholder">×</span>
          ) : v.current_render_status === "warn" ? (
            <span className="placeholder warn">!</span>
          ) : (
            <span className="thumb-shimmer" aria-label="rendering" />
          )}
        </div>
        <div className="row-title">{v.title}</div>
        <span className="row-type">
          <span className="row-fmt-dot" style={{ background: fmtColorVar(v.type) }} />
          {v.type}
        </span>
        <span className="row-project">{v.project_name}</span>
        <div className="row-tags">
          {visibleTags.map((t) => (
            <span key={t} className="mini-chip" style={{ color: tagColor(t) }}>
              <span className="swatch" style={{ background: tagColorMap.get(t) ?? tagColor(t) }} />
              {t}
            </span>
          ))}
          {overflow > 0 && <span className="row-tag-overflow">+{overflow}</span>}
        </div>
        <span className="row-updated">{relativeTime(v.updated_at)}</span>
        {opts.archived ? (
          <button
            className="btn ghost"
            style={{ height: 26, fontSize: 11.5, padding: "0 8px" }}
            onClick={(e) => {
              e.stopPropagation();
              void restoreVisual(v.id);
            }}
          >
            Restore
          </button>
        ) : (
          <button
            className={`star-btn${v.starred ? " on" : ""}`}
            title={v.starred ? "Unstar" : "Star"}
            onClick={(e) => {
              e.stopPropagation();
              void patchVisual(v.id, { starred: !v.starred });
            }}
          >
            <Icon name={v.starred ? "star-fill" : "star"} size={15} />
          </button>
        )}
      </div>
    );
  }

  function renderCard(v: VisualGridItem, opts: { archived?: boolean; index?: number } = {}) {
    const isSelected = v.id === selectedVisualId;
    const isFresh = freshIds.includes(v.id);
    const isPulsing = pulseIds.includes(v.id);
    const isKFocus = focusedCardId === v.id;
    const isSpringing = springingStarId === v.id;
    const sourceLabel = v.source && v.source !== "claude" && v.source !== "manual" ? SOURCE_LABEL[v.source] ?? v.source : null;
    const failed = v.current_render_status === "failed";
    const warn = v.current_render_status === "warn";
    return (
      <article
        key={v.id}
        ref={(el) => {
          if (el) cardRefs.current.set(v.id, el);
          else cardRefs.current.delete(v.id);
        }}
        data-kfocus={isKFocus ? "true" : undefined}
        className={`card${isSelected ? " selected" : ""}${isFresh ? " fresh" : ""}${isPulsing ? " pulse" : ""}${isKFocus ? " kfocus" : ""}`}
        onClick={() => setSelectedVisualId(v.id)}
        onDoubleClick={() => window.open(`/v/${v.id}`, "_blank", "noopener")}
        onMouseEnter={() => setFocusedCardId(v.id)}
        style={isFresh ? { animationDelay: `${Math.min(opts.index ?? 0, 8) * 30}ms` } : undefined}
      >
        <div className="card-thumb" style={{ "--fmt-color": fmtColorVar(v.type) } as React.CSSProperties}>
          {v.current_render_status === "ok" && v.thumb_version != null ? (
            <img src={`/thumbs/${v.id}/v${v.thumb_version}.png`} alt={v.title} />
          ) : failed ? (
            <span className="placeholder">render failed</span>
          ) : warn ? (
            <span className="placeholder warn">saved as-is</span>
          ) : (
            <span className="thumb-shimmer" aria-label="rendering" />
          )}
          <span className="badge tl">{v.type}</span>
          {sourceLabel && <span className="badge bl">via {sourceLabel}</span>}
          {failed && <span className="badge failed">failed</span>}
          {warn && <span className="badge warn">warn</span>}
          <div className="fmt-rule" />
          {!opts.archived && (
            <button
              className={`star-btn${v.starred ? " on" : ""}${isSpringing ? " springing" : ""}`}
              title={v.starred ? "Unstar" : "Star"}
              onClick={(e) => {
                e.stopPropagation();
                void patchVisual(v.id, { starred: !v.starred });
                triggerStarSpring(v.id);
              }}
            >
              <Icon name={v.starred ? "star-fill" : "star"} size={15} />
            </button>
          )}
        </div>
        <div className="card-body">
          <div className="card-title">{v.title}</div>
          <div className="card-meta">
            {v.current_ver > 1 && <span className="ver">v{v.current_ver}</span>}
            <span>{v.project_name}</span>
            <span className="dot" />
            <span>{relativeTime(v.updated_at)}</span>
          </div>
          {opts.archived && (
            <button
              className="btn ghost"
              style={{ height: 26, fontSize: 11.5, padding: "0 8px", alignSelf: "flex-start" }}
              onClick={(e) => {
                e.stopPropagation();
                void restoreVisual(v.id);
              }}
            >
              Restore
            </button>
          )}
        </div>
      </article>
    );
  }

  const filtersActive = activeTags.length > 0 || query.length > 0;
  const totalLibrary = libraryCounts.all;

  const gridIds = useMemo<string[]>(() => {
    if (isSearching) return (searchResults ?? []).map((r) => r.id);
    if (isArchivedView) return [];
    return visuals.map((v) => v.id);
  }, [isSearching, isArchivedView, searchResults, visuals]);

  const starredFor = useCallback(
    (id: string) => {
      const inGrid = visuals.find((v) => v.id === id);
      if (inGrid) return Boolean(inGrid.starred);
      const inSearch = searchResults?.find((r) => r.id === id);
      return Boolean(inSearch?.starred);
    },
    [visuals, searchResults]
  );

  useEffect(() => {
    if (focusedCardId && !gridIds.includes(focusedCardId)) {
      setFocusedCardId(null);
    }
  }, [gridIds, focusedCardId]);

  useEffect(() => {
    if (!focusedCardId) return;
    const el = cardRefs.current.get(focusedCardId);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedCardId]);

  kbdRef.current = {
    query,
    selectedVisualId,
    focusedCardId,
    claudeMenuOpen,
    downloadMenuOpen,
    projectMenu,
    mergeModal,
    exportZipFor,
    confirmArchive,
    titleDraft,
    showTagInput,
    gridIds,
    starredFor,
    patch: (id, body) => void patchVisual(id, body),
    setQuery,
    setSelectedVisualId,
    setFocusedCardId,
    setClaudeMenuOpen,
    setDownloadMenuOpen,
    setProjectMenu,
    setMergeModal,
    setExportZipFor,
    setConfirmArchive,
    setTitleDraft,
    setShowTagInput,
    setCmdKDropped,
    showCheatsheet,
    setShowCheatsheet,
    confirmSpecOpen: confirmSpec !== null,
    setConfirmSpec,
    copyFallback,
    setCopyFallback,
    cycleSidebar,
    clearAllFilters: () => {
      setActiveTags([]);
      setQuery("");
    },
  };

  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }
    function onKey(e: KeyboardEvent) {
      const s = kbdRef.current;
      if (!s) return;
      const inSearchInput = e.target === searchInputRef.current;
      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        s.setQuery("");
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key === "Escape") {
        if (s.showCheatsheet) { s.setShowCheatsheet(false); return; }
        if (s.copyFallback !== null) { s.setCopyFallback(null); return; }
        if (s.confirmSpecOpen) { s.setConfirmSpec(null); return; }
        if (s.claudeMenuOpen) { s.setClaudeMenuOpen(false); return; }
        if (s.downloadMenuOpen) { s.setDownloadMenuOpen(false); return; }
        if (s.projectMenu) { s.setProjectMenu(null); return; }
        if (s.mergeModal) { s.setMergeModal(null); return; }
        if (s.exportZipFor) { s.setExportZipFor(null); return; }
        if (s.confirmArchive) { s.setConfirmArchive(false); return; }
        if (s.showTagInput) { s.setShowTagInput(false); return; }
        if (s.titleDraft !== null) { s.setTitleDraft(null); return; }
        if (inSearchInput) {
          if (s.query) s.setQuery("");
          searchInputRef.current?.blur();
          return;
        }
        if (s.selectedVisualId) { s.setSelectedVisualId(null); return; }
        if (s.focusedCardId) { s.setFocusedCardId(null); return; }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        s.clearAllFilters();
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (e.key === "?") {
        e.preventDefault();
        s.setShowCheatsheet((v) => !v);
        return;
      }

      if (e.key === "/" || e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key === "j" || e.key === "k") {
        const ids = s.gridIds;
        if (ids.length === 0) return;
        const cur = s.focusedCardId ?? s.selectedVisualId;
        const idx = cur ? ids.indexOf(cur) : -1;
        const next =
          e.key === "j"
            ? idx === -1 ? 0 : (idx + 1) % ids.length
            : idx === -1 ? ids.length - 1 : (idx - 1 + ids.length) % ids.length;
        s.setFocusedCardId(ids[next] ?? null);
        e.preventDefault();
        return;
      }

      if (e.key === "Enter" && s.focusedCardId) {
        s.setSelectedVisualId(s.focusedCardId);
        e.preventDefault();
        return;
      }

      if (e.key === "s" && s.focusedCardId) {
        const id = s.focusedCardId;
        s.patch(id, { starred: !s.starredFor(id) });
        e.preventDefault();
        return;
      }

      if (e.key === "b") {
        s.cycleSidebar();
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-frame">
      <div className="shell-pad">
        <div
          className="shell"
          data-sidebar={sidebarMode === "rail" && sidebarPeek ? "rail-peek" : sidebarMode}
          data-drawer={detail ? "open" : "hidden"}
          data-workbench={claudeMenuOpen ? "open" : undefined}
        >
          {/* Chrome */}
          <header className="chrome">
            <button
              className="icon-btn sidebar-toggle"
              title={`Sidebar: ${sidebarMode} — click to ${SIDEBAR_CYCLE[sidebarMode]}`}
              aria-label="Toggle sidebar"
              onClick={cycleSidebar}
            >
              <Icon name="sidebar" size={16} />
            </button>
            <div className={`wordmark${markTilt ? " tilt" : ""}`}>
              <span className="mark">
                <img src="/logo-A-v4-faithful.png" alt="Magpie" width={26} height={26} />
              </span>
              <span className="name">magpie</span>
            </div>
            <div style={{ width: 14 }} />
            <div className="chrome-search">
              <Icon name="search" size={15} />
              <input
                ref={searchInputRef}
                placeholder="Search visuals, projects, tags…"
                aria-label="Search visuals, projects, tags"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button className="clear" onClick={() => setQuery("")} title="Clear">
                  <Icon name="x" size={14} />
                </button>
              ) : (
                !cmdKDropped && <span className="kbd">⌘K</span>
              )}
            </div>
            <div className="chrome-spacer" />
            <div className="chrome-actions">
              <span
                className="conn-pill"
                data-state={mcpStatus}
                title={mcpStatus === "connected" ? "Magpie MCP — Claude connected" : "Magpie MCP — Claude not connected"}
              >
                <span className="dot" />
                <span>magpie-mcp</span>
              </span>
              <button
                className="icon-btn"
                title="Keyboard shortcuts (?)"
                aria-label="Keyboard shortcuts"
                onClick={() => setShowCheatsheet(true)}
              >
                <Icon name="question" size={16} />
              </button>
              <button
                className="icon-btn"
                title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              >
                <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
              </button>
            </div>
          </header>

          {/* Sidebar */}
          <aside
            className="sidebar"
            aria-label="Project navigation"
            onMouseEnter={onSidebarMouseEnter}
            onMouseLeave={onSidebarMouseLeave}
          >
            <div className="side-section">
              <div className="label"><span>Library</span></div>
              <button
                className="nav-item"
                aria-current={!isStarredView && !isArchivedView && !selectedProjectId}
                onClick={() => { setSelectedProjectId(null); setSelectedVisualId(null); }}
              >
                <Icon name="folder" size={14} className="ico" />
                <span className="name">All visuals</span>
                <span className="count">{totalLibrary}</span>
              </button>
              <button
                className="nav-item"
                aria-current={isStarredView}
                onClick={() => { setSelectedProjectId(STARRED_ID); setSelectedVisualId(null); }}
              >
                <Icon name="star-fill" size={14} className="ico" />
                <span className="name">Starred</span>
                <span className="count">{libraryCounts.starred}</span>
              </button>
              <button
                className="nav-item"
                aria-current={isArchivedView}
                onClick={() => { setSelectedProjectId(ARCHIVED_ID); setSelectedVisualId(null); }}
              >
                <Icon name="archive" size={14} className="ico" />
                <span className="name">Archived</span>
                <span className="count">{archivedProjects.length}</span>
              </button>
              <button
                className="nav-item"
                aria-current={isInboxView}
                onClick={() => { setSelectedProjectId(INBOX_ID); setSelectedVisualId(null); }}
                title="Queued prompts waiting for the agent (read_inbox)"
              >
                <Icon name="bolt" size={14} className="ico" />
                <span className="name">Outbox</span>
                <span className="count">{inboxPendingCount}</span>
              </button>
              {/* S7 P5.A — Templates row sits between Outbox and Tags.
                  `/templates` is a server-rendered route + island, so we
                  navigate with a plain anchor rather than React state. */}
              <a
                className="nav-item"
                href="/templates"
                title="Manage send-to-agent templates"
              >
                <Icon name="template" size={14} className="ico" />
                <span className="name">Templates</span>
              </a>
            </div>

            <div className="side-divider" />

            <div className="side-section">
              <div className="label"><span>Projects</span></div>
              {error && <p className="side-note" style={{ color: "var(--terra-deep)" }}>Error: {error}</p>}
              {!projects && !error && <p className="side-note">Loading…</p>}
              {projects?.map((p) => {
                const isRenaming = renamingProject?.pid === p.id;
                const isCurrent = selectedProjectId === p.id;
                return (
                  <div key={p.id} className="nav-item-wrap">
                    <button
                      className="nav-item"
                      aria-current={isCurrent}
                      title={p.description ?? undefined}
                      onClick={() => {
                        if (isRenaming) return;
                        setSelectedProjectId(p.id);
                        setSelectedVisualId(null);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setProjectMenu({ pid: p.id, name: p.name, x: e.clientX, y: e.clientY });
                      }}
                    >
                      {isCurrent
                        ? <span className="swatch" style={{ background: "var(--accent)" }} />
                        : <Icon name="folder" size={14} className="ico" />}
                      {isRenaming ? (
                        <input
                          autoFocus
                          className="rename-input"
                          aria-label={`Rename project ${p.name}`}
                          value={renamingProject.value}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenamingProject({ pid: p.id, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const newName = renamingProject.value.trim();
                              setRenamingProject(null);
                              if (newName && newName !== p.name) void renameProj(p.name, newName);
                            } else if (e.key === "Escape") {
                              setRenamingProject(null);
                            }
                          }}
                          onBlur={() => setRenamingProject(null)}
                        />
                      ) : (
                        <>
                          <span className="name">{p.name}</span>
                          <span className="count">{p.visual_count}</span>
                        </>
                      )}
                    </button>
                    {!isRenaming && (
                      <button
                        className="nav-kebab"
                        title="Project actions"
                        aria-label={`Actions for ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const x = r.right;
                          const y = r.bottom + 4;
                          window.setTimeout(() => {
                            setProjectMenu({ pid: p.id, name: p.name, x, y });
                          }, 0);
                        }}
                      >
                        <Icon name="kebab" size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {tagAggregates.length > 0 && (
              <>
                <div className="side-divider" />
                <div className="side-section">
                  <div className="label"><span>Tags</span></div>
                  {tagAggregates.slice(0, 5).map((t) => {
                    const isActive = activeTags.includes(t.name);
                    return (
                      <button
                        key={t.name}
                        className={`nav-item tag-row${isActive ? " active" : ""}`}
                        aria-pressed={isActive}
                        onClick={() => setActiveTags((prev) => isActive ? prev.filter((x) => x !== t.name) : [...prev, t.name])}
                      >
                        <span className="swatch" style={{ background: t.color ?? tagColor(t.name) }} />
                        <span className="name">{t.name}</span>
                        <span className="count">{t.count}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="side-spacer" />

            <div className="side-footer" title="Keyboard shortcuts">
              {KEYBOARD_HINTS.map((h) => (
                <span key={h.key} className="kbd-hint">
                  <kbd>{h.key}</kbd>
                  <span className="what">{h.what}</span>
                </span>
              ))}
              {!cmdKDropped && (
                <span className="kbd-hint">
                  <kbd>{KEYBOARD_HINT_CMDK.key}</kbd>
                  <span className="what">{KEYBOARD_HINT_CMDK.what}</span>
                </span>
              )}
            </div>
          </aside>

          {/* Main */}
          <main className="main" aria-label="Library">

            {showReconnectBanner && !wsConnected && (
              <div className="ws-banner">
                <Icon name="bolt" size={12} /> Reconnecting to Magpie…
              </div>
            )}

            {isInboxView && (
              <OutboxView refreshKey={inboxRefreshKey} pushToast={pushToast} />
            )}
            {!isInboxView && (<>
            <div className="filter-bar">
              <div className="filter-chips">
                {activeTags.map((tag) => {
                  const chipId = `tag:${tag}`;
                  const leaving = leavingChips.has(chipId);
                  return (
                    <span key={tag} className={`filter-chip${leaving ? " leaving" : ""}`}>
                      <span className="swatch" style={{ background: tagColorMap.get(tag) ?? tagColor(tag) }} />
                      <span className="v">{tag}</span>
                      <button
                        className="x"
                        aria-label={`Remove tag ${tag}`}
                        onClick={() => removeChipWithBleed(chipId, () => setActiveTags((c) => c.filter((x) => x !== tag)))}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  );
                })}
                {query && (() => {
                  const leaving = leavingChips.has("q");
                  return (
                    <span className={`filter-chip${leaving ? " leaving" : ""}`}>
                      <span className="k">q</span>
                      <span className="v">"{query}"</span>
                      <button
                        className="x"
                        aria-label="Clear search"
                        onClick={() => removeChipWithBleed("q", () => setQuery(""))}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  );
                })()}
                {filtersActive && (
                  <button
                    className="filter-clear"
                    onClick={() => {
                      setActiveTags([]);
                      setQuery("");
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="filter-spacer" />
              <button
                className={`filter-tag-trigger${activeTags.length > 0 ? " active" : ""}`}
                onClick={(e) => {
                  if (tagPickerPos) {
                    setTagPickerPos(null);
                    return;
                  }
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const top = r.bottom + 6;
                  const left = Math.max(8, r.left);
                  window.setTimeout(() => setTagPickerPos({ top, left }), 0);
                }}
                aria-haspopup="dialog"
                aria-expanded={tagPickerPos !== null}
              >
                <Icon name="tag" size={13} />
                <span>Tags{activeTags.length > 0 ? ` · ${activeTags.length}` : ""}</span>
                <Icon name="chevron-down" size={11} />
              </button>
              <div className="view-toggle" role="group" aria-label="View mode">
                <button
                  className={`vt-btn${viewMode === "grid" ? " on" : ""}`}
                  title="Grid view"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                >
                  <Icon name="grid" size={14} />
                </button>
                <button
                  className={`vt-btn${viewMode === "list" ? " on" : ""}`}
                  title="List view"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                >
                  <Icon name="list" size={14} />
                </button>
              </div>
              <span className="filter-meta">
                {selectedProjectId === ARCHIVED_ID && !isSearching ? (
                  <>
                    <b>{archivedProjects.length}</b> archived {archivedProjects.length === 1 ? "project" : "projects"}
                  </>
                ) : (
                  <>
                    Showing <b>{isSearching ? (searchResults?.length ?? 0) : visuals.length}</b>
                    {totalLibrary > 0 ? <> of <b>{totalLibrary}</b></> : null}
                  </>
                )}
              </span>
            </div>

            <div className="grid-scroll">
              <div className="grid-inner">
                {isSearching ? (
                  <>
                    <div className="section-head">
                      <h2>Search</h2>
                      <span className="sub">
                        {searchResults === null
                          ? "searching…"
                          : `${searchResults.length} match${searchResults.length === 1 ? "" : "es"}${debouncedQuery ? ` for "${debouncedQuery}"` : ""}`}
                      </span>
                    </div>
                    {searchResults && searchResults.length === 0 ? (
                      <EmptyState
                        kind="search"
                        glyph={<Icon name="search" size={26} />}
                        title={debouncedQuery ? `No matches for "${debouncedQuery}"` : "No matches"}
                        body={searchEmpty(debouncedQuery).msg + " " + EMPTY_STATE_COPY.search.body}
                        helper={
                          <>
                            <kbd>Esc</kbd>
                            <span> to clear ·</span>
                            <button
                              className="link-btn"
                              onClick={() => {
                                setActiveTags([]);
                                setQuery("");
                              }}
                            >
                              {searchEmpty(debouncedQuery).clearLabel}
                            </button>
                          </>
                        }
                      />
                    ) : viewMode === "list" ? (
                      <div className="row-list">
                        {searchResults?.map((r) => renderRow({
                          id: r.id, title: r.title, type: r.type, current_ver: r.current_ver,
                          current_render_status: r.current_render_status, thumb_version: r.thumb_version,
                          starred: r.starred, updated_at: r.updated_at,
                          project_name: r.project_name, tag_names: r.tag_names,
                        }))}
                      </div>
                    ) : (
                      <div className="card-grid">
                        {searchResults?.map((r, i) => {
                          const isKFocus = focusedCardId === r.id;
                          const failed = r.current_render_status === "failed";
                          const warn = r.current_render_status === "warn";
                          return (
                          <article
                            key={r.id}
                            ref={(el) => {
                              if (el) cardRefs.current.set(r.id, el);
                              else cardRefs.current.delete(r.id);
                            }}
                            data-kfocus={isKFocus ? "true" : undefined}
                            className={`card${r.id === selectedVisualId ? " selected" : ""}${isKFocus ? " kfocus" : ""}`}
                            onClick={() => setSelectedVisualId(r.id)}
                            onMouseEnter={() => setFocusedCardId(r.id)}
                            style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                          >
                            <div className="card-thumb" style={{ "--fmt-color": fmtColorVar(r.type) } as React.CSSProperties}>
                              {r.current_render_status === "ok" && r.thumb_version != null ? (
                                <img src={`/thumbs/${r.id}/v${r.thumb_version}.png`} alt={r.title} />
                              ) : failed ? (
                                <span className="placeholder">render failed</span>
                              ) : warn ? (
                                <span className="placeholder warn">saved as-is</span>
                              ) : (
                                <span className="thumb-shimmer" aria-label="rendering" />
                              )}
                              <span className="badge tl">{r.type}</span>
                              {failed && <span className="badge failed">failed</span>}
                              {warn && <span className="badge warn">warn</span>}
                              <div className="fmt-rule" />
                            </div>
                            <div className="card-body">
                              <div className="card-title">{r.title}</div>
                              <div className="card-meta">
                                {r.current_ver > 1 && <span className="ver">v{r.current_ver}</span>}
                                <span>{r.project_name}</span>
                              </div>
                              {r.tag_names && (
                                <div className="card-tags">
                                  {r.tag_names.split(",").filter(Boolean).slice(0, 3).map((t) => (
                                    <span key={t} className="mini-chip" style={{ color: colorForTag(t) }}>
                                      <span className="swatch" />
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </article>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : projects && projects.length === 0 ? (
                  <div className="empty-card">
                    <img className="empty-hero" src="/logo-A-v4-faithful.png" alt="" width={120} height={120} />
                    <p className="empty-tagline">your loyal Magpie lands every visual in the nest</p>
                    <h2 className="empty-title">{DASHBOARD_EMPTY.title}</h2>
                    <p className="muted">{DASHBOARD_EMPTY.body}</p>
                    <div className="empty-cta-row">
                      <a
                        className="btn primary"
                        href="https://github.com/omerb784/magpie-mcp#install"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Ask Claude to create your first visual
                      </a>
                      <button
                        className="btn ghost"
                        disabled={seedLoading}
                        onClick={async () => {
                          if (seedLoading) return;
                          setSeedLoading(true);
                          try {
                            const r = await fetch("/api/seed/load-example", { method: "POST" });
                            if (r.status === 200) {
                              const body = (await r.json()) as { created: boolean; projectId: string };
                              pushToast("success", "Example project loaded", "atlas");
                              refreshProjects();
                              setSelectedProjectId(body.projectId);
                              setSelectedVisualId(null);
                            } else if (r.status === 409) {
                              const body = (await r.json()) as { existing: boolean; projectId: string };
                              pushToast("info", "Example project already loaded");
                              refreshProjects();
                              setSelectedProjectId(body.projectId);
                              setSelectedVisualId(null);
                            } else {
                              pushToast("error", `Seed failed (HTTP ${r.status})`);
                            }
                          } catch (e) {
                            pushToast("error", `Seed failed: ${(e as Error).message}`);
                          } finally {
                            setSeedLoading(false);
                          }
                        }}
                      >
                        {seedLoading ? "Loading…" : "Load example project"}
                      </button>
                    </div>
                    <ol className="empty-steps">
                      {DASHBOARD_EMPTY.steps.map((s, i) => (
                        <li key={i}>
                          <strong>{s.label}.</strong>{" "}
                          <span className="muted">{s.detail}</span>
                        </li>
                      ))}
                    </ol>
                    <h3>{DASHBOARD_EMPTY.snippetHeading}</h3>
                    <div className="snippet-tabs" role="tablist">
                      <button
                        role="tab"
                        className={emptyConfigTab === "code" ? "active" : ""}
                        onClick={() => setEmptyConfigTab("code")}
                      >
                        Claude Code
                      </button>
                      <button
                        role="tab"
                        className={emptyConfigTab === "desktop" ? "active" : ""}
                        onClick={() => setEmptyConfigTab("desktop")}
                      >
                        Claude Desktop
                      </button>
                    </div>
                    {emptyConfig.kind === "error" ? (
                      <>
                        <pre className="code error">Couldn't load config snippet — try reloading.</pre>
                        <button className="btn ghost" onClick={loadEmptyConfig}>
                          Retry
                        </button>
                      </>
                    ) : (
                      <>
                        <pre className="code">
                          {emptyConfig.kind === "ok"
                            ? emptyConfig[emptyConfigTab]
                            : "loading…"}
                        </pre>
                        <button
                          className="btn primary"
                          disabled={emptyConfig.kind !== "ok"}
                          onClick={async () => {
                            if (emptyConfig.kind !== "ok") return;
                            const text = emptyConfig[emptyConfigTab];
                            try {
                              await navigator.clipboard.writeText(text);
                              pushToast(
                                "success",
                                `${emptyConfigTab === "code" ? "Claude Code" : "Claude Desktop"} snippet copied`,
                                "Copy snippet"
                              );
                            } catch {
                              pushToast("error", "Clipboard blocked — copy manually");
                            }
                          }}
                        >
                          Copy {emptyConfigTab === "code" ? "Code" : "Desktop"} snippet
                        </button>
                      </>
                    )}
                  </div>
                ) : isArchivedView ? (() => {
                  const q = archivedFilter.trim().toLowerCase();
                  const filtered = q
                    ? archivedProjects.filter((p) => p.name.toLowerCase().includes(q))
                    : archivedProjects;
                  return (
                    <>
                      <div className="section-head">
                        <h2>{sectionTitle}</h2>
                        <span className="sub">{sectionSub}</span>
                      </div>
                      {archivedProjects.length > 0 && (
                        <div className="archived-filter">
                          <input
                            type="search"
                            value={archivedFilter}
                            onChange={(e) => setArchivedFilter(e.target.value)}
                            placeholder="Filter archived projects by name…"
                            aria-label="Filter archived projects"
                          />
                          {archivedFilter && (
                            <button
                              className="link-btn"
                              onClick={() => setArchivedFilter("")}
                            >
                              clear
                            </button>
                          )}
                          <span className="sub">
                            {q
                              ? `${filtered.length} of ${archivedProjects.length}`
                              : `${archivedProjects.length} archived`}
                          </span>
                        </div>
                      )}
                      {archivedProjects.length === 0 ? (
                        <EmptyState
                          kind="archived"
                          glyph={<Icon name="archive" size={26} />}
                          title="Nothing archived yet"
                          body={ARCHIVED_PROJECTS_EMPTY + " " + EMPTY_STATE_COPY.archived.body}
                          helper={<>{EMPTY_STATE_COPY.archived.helperKbd}</>}
                        />
                      ) : filtered.length === 0 ? (
                        <p className="side-note" style={{ padding: "20px 4px" }}>
                          No archived projects match "{archivedFilter}".
                        </p>
                      ) : (
                        <div className="card-grid">
                          {filtered.map((p) => (
                            <article key={p.id} className="card">
                              <div className="card-thumb">
                                <span className="placeholder">archived project</span>
                                <span className="badge tl">project</span>
                              </div>
                              <div className="card-body">
                                <div className="card-title">{p.name}</div>
                                <div className="card-meta">
                                  <span>{p.visual_count} visuals</span>
                                  <span className="dot" />
                                  <span>{p.type}</span>
                                </div>
                                <button
                                  className="btn ghost"
                                  style={{ height: 28, fontSize: 12, padding: "0 8px", alignSelf: "flex-start" }}
                                  onClick={() => void restoreProj(p.name)}
                                >
                                  <Icon name="refresh" size={13} /> Restore
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })() : (
                  <>
                    <div className="section-head">
                      <h2>{sectionTitle}</h2>
                      <span className="sub">{sectionSub}</span>
                      {selectedProjectId !== null && !isStarredView && !isArchivedView && (
                        <button
                          className="btn ghost"
                          style={{ marginLeft: "auto", height: 26, fontSize: 11.5, padding: "0 8px" }}
                          onClick={() => setShowArchived((v) => !v)}
                        >
                          {showArchived ? "Hide archived" : "Show archived"}
                        </button>
                      )}
                    </div>
                    {selectedProjectId && visuals.length === 0 && archivedVisuals.length === 0 && (
                      isStarredView ? (
                        <EmptyState
                          kind="starred"
                          glyph={<Icon name="star" size={26} />}
                          glyphAccent
                          title="Your starred visuals will live here"
                          body={STARRED_EMPTY + " " + EMPTY_STATE_COPY.starred.body}
                          helper={<><kbd>s</kbd><span>{" on any focused card to star"}</span></>}
                        />
                      ) : (
                        <p className="side-note" style={{ padding: "20px 4px" }}>
                          {projectEmpty(selectedProject?.name ?? "this project")}
                        </p>
                      )
                    )}
                    {viewMode === "list" ? (
                      <div className="row-list">
                        {visuals.map((v) => renderRow(v))}
                      </div>
                    ) : (
                      <div className="card-grid">
                        {visuals.map((v, i) => renderCard(v, { index: i }))}
                      </div>
                    )}
                    {showArchived && !isStarredView && !isArchivedView && (
                      <>
                        <div className="section-head" style={{ marginTop: 32 }}>
                          <h2 style={{ fontSize: 16 }}>Archived</h2>
                          <span className="sub">
                            {archivedVisuals.length === 0 ? "none in this project" : `${archivedVisuals.length} hidden`}
                          </span>
                        </div>
                        {archivedVisuals.length === 0 ? (
                          <p className="side-note" style={{ padding: "12px 4px" }}>
                            No archived visuals here. Archive a card from the drawer to see it land in this section.
                          </p>
                        ) : viewMode === "list" ? (
                          <div className="row-list">
                            {archivedVisuals.map((v) => renderRow(v, { archived: true }))}
                          </div>
                        ) : (
                          <div className="card-grid">
                            {archivedVisuals.map((v) => renderCard(v, { archived: true }))}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
            </>)}
          </main>

          {/* Drawer — only rendered when a visual is selected */}
          {detail && (
            <aside className="drawer">
              <div
                className={`drawer-hero${heroPulseId === detail.visual.id ? " pulse" : ""}`}
                style={{ "--fmt-color": fmtColorVar(detail.visual.type) } as React.CSSProperties}
              >
                {detail.visual.current_render_status === "ok" && detail.visual.thumb_version != null ? (
                  <img src={`/thumbs/${detail.visual.id}/v${detail.visual.thumb_version}.png`} alt={detail.visual.title} />
                ) : detail.visual.current_render_status === "failed" ? (
                  <span className="placeholder">render failed</span>
                ) : detail.visual.current_render_status === "warn" ? (
                  <span className="placeholder warn">saved as-is</span>
                ) : (
                  <span className="hero-shimmer" aria-label="rendering" />
                )}
                <span className="badge tl">{detail.visual.type}</span>
                <div className="fmt-rule" />
              </div>

              <div>
                {titleDraft === null ? (
                  <h2
                    className="drawer-title"
                    title="Click to rename"
                    onClick={() => setTitleDraft(detail.visual.title)}
                  >
                    {detail.visual.title}
                  </h2>
                ) : (
                  <input
                    autoFocus
                    className="drawer-title-input"
                    aria-label="Visual title"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const next = titleDraft.trim();
                        if (next && next !== detail.visual.title) {
                          void patchVisual(detail.visual.id, { title: next });
                        }
                        setTitleDraft(null);
                      } else if (e.key === "Escape") {
                        setTitleDraft(null);
                      }
                    }}
                    onBlur={() => {
                      const next = titleDraft.trim();
                      if (next && next !== detail.visual.title) {
                        void patchVisual(detail.visual.id, { title: next });
                      }
                      setTitleDraft(null);
                    }}
                  />
                )}
                <div className="drawer-meta">
                  <span>{detail.visual.type}</span>
                  <span className="dot" />
                  <span>current v{detail.visual.current_ver}</span>
                  <span className="dot" />
                  <span>{relativeTime(detail.visual.updated_at)}</span>
                  {detail.visual.source && detail.visual.source !== "claude" && detail.visual.source !== "manual" && (
                    <>
                      <span className="dot" />
                      <span>via {SOURCE_LABEL[detail.visual.source] ?? detail.visual.source}</span>
                    </>
                  )}
                  {detail.visual.archived_at && (
                    <>
                      <span className="dot" />
                      <span style={{ color: "var(--terra-deep)" }}>ARCHIVED</span>
                    </>
                  )}
                </div>
                {(() => {
                  const cur = detail.versions.find((x) => x.version_num === detail.visual.current_ver);
                  if (!cur) return null;
                  return (
                    <details className="drawer-details">
                      <summary>Details</summary>
                      <dl>
                        <dt>render</dt>
                        <dd>
                          <span className={`render-badge ${cur.render_status}`}>{cur.render_status}</span>
                          {cur.render_error && <span className="render-err">{cur.render_error}</span>}
                        </dd>
                        <dt>bytes</dt>
                        <dd>{cur.bytes === null ? <span className="muted">missing</span> : formatBytes(cur.bytes)}</dd>
                        <dt>path</dt>
                        <dd className="mono path" title={cur.content_path}>{basename(cur.content_path)}</dd>
                      </dl>
                    </details>
                  );
                })()}
              </div>

              <div className="actions">
                <a className="btn primary" href={`/v/${detail.visual.id}`} target="_blank" rel="noreferrer">
                  <Icon name="external" size={14} /> Open preview
                </a>
                {(() => {
                  const len = detail.versions.length;
                  if (len < 2) return null;
                  const prev = detail.versions[len - 2];
                  const last = detail.versions[len - 1];
                  if (!prev || !last) return null;
                  return (
                    <a
                      className="btn ghost"
                      href={`/compare/${detail.visual.id}?a=${prev.version_num}&b=${last.version_num}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="compare" size={14} /> Compare v{prev.version_num} ↔ v{last.version_num}
                    </a>
                  );
                })()}
                <button
                  className="btn gradient"
                  onClick={() => setClaudeMenuOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={claudeMenuOpen}
                >
                  <Icon name="send" size={14} /> Talk with agent
                </button>
                <div className="download-anchor">
                  <button
                    ref={downloadBtnRef}
                    className="btn ghost"
                    onClick={() => {
                      setDownloadVer(detail.visual.current_ver);
                      setDownloadMenuOpen((v) => !v);
                    }}
                    aria-haspopup="menu"
                    aria-expanded={downloadMenuOpen}
                    title="Download…"
                  >
                    <Icon name="download" size={14} /> Download
                    <Icon name="chevron-down" size={12} />
                  </button>
                </div>
                <button
                  className={`btn ghost icon-only${detail.visual.starred ? " starred" : ""}`}
                  title={detail.visual.starred ? "Unstar" : "Star"}
                  onClick={() => void patchVisual(detail.visual.id, { starred: !detail.visual.starred })}
                >
                  <Icon name={detail.visual.starred ? "star-fill" : "star"} size={15} />
                </button>
                <button
                  className="btn ghost"
                  title="Re-render thumbnail"
                  onClick={() => void reRenderVersion(detail.visual.id, detail.visual.current_ver)}
                >
                  <Icon name="refresh" size={14} />
                </button>
              </div>

              <div>
                <h3 className="drawer-h3">Description</h3>
                {descDraft === null ? (
                  detail.visual.description ? (
                    <p
                      className="drawer-description"
                      title="Click to edit"
                      onClick={() => setDescDraft(detail.visual.description ?? "")}
                    >
                      {detail.visual.description}
                    </p>
                  ) : (
                    <button
                      className="drawer-description-empty"
                      onClick={() => setDescDraft("")}
                    >
                      + Add description
                    </button>
                  )
                ) : (
                  <textarea
                    autoFocus
                    className="drawer-description-input"
                    aria-label="Visual description"
                    value={descDraft}
                    maxLength={1000}
                    placeholder="What's this visual for? ≤1000 chars."
                    onChange={(e) => setDescDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setDescDraft(null);
                      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        const next = descDraft.trim();
                        const value = next.length > 0 ? next : null;
                        if (value !== (detail.visual.description ?? null)) {
                          void patchVisual(detail.visual.id, { description: value });
                        }
                        setDescDraft(null);
                      }
                    }}
                    onBlur={() => {
                      const next = descDraft.trim();
                      const value = next.length > 0 ? next : null;
                      if (value !== (detail.visual.description ?? null)) {
                        void patchVisual(detail.visual.id, { description: value });
                      }
                      setDescDraft(null);
                    }}
                  />
                )}
              </div>

              <div>
                <h3 className="drawer-h3">Tags</h3>
                <div className="tag-editor">
                  {detail.tags.map((t) => (
                    <span key={t.id} className="tag-chip active">
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.color ?? colorForTag(t.name), display: "inline-block" }} />
                      {t.name}
                      <button
                        className="x"
                        title="Remove tag"
                        onClick={() => {
                          const next = detail.tags.filter((x) => x.id !== t.id).map((x) => x.name);
                          void patchVisual(detail.visual.id, { tags: next });
                        }}
                      >
                        <Icon name="x" size={11} />
                      </button>
                    </span>
                  ))}
                  {showTagInput ? (
                    <input
                      autoFocus
                      className="tag-input"
                      aria-label="New tag name"
                      value={tagInput}
                      placeholder="tag name"
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const name = tagInput.trim();
                          if (!name) return;
                          const next = [...detail.tags.map((t) => t.name), name];
                          void patchVisual(detail.visual.id, { tags: next });
                          setTagInput("");
                          setShowTagInput(false);
                        } else if (e.key === "Escape") {
                          setTagInput("");
                          setShowTagInput(false);
                        }
                      }}
                      onBlur={() => {
                        setTagInput("");
                        setShowTagInput(false);
                      }}
                    />
                  ) : (
                    <button className="tag-chip dashed" onClick={() => setShowTagInput(true)}>
                      <Icon name="plus" size={10} /> add
                    </button>
                  )}
                </div>
              </div>

              <div>
                <h3 className="drawer-h3">Versions · {detail.versions.length}</h3>
                <div className="timeline">
                  {detail.versions.slice().reverse().map((vv) => {
                    const isCurrent = vv.version_num === detail.visual.current_ver;
                    const failed = vv.render_status === "failed";
                    return (
                      <div key={vv.id} className={`timeline-row${isCurrent ? " current" : ""}${failed ? " failed" : ""}`}>
                        <span className="ver-badge">v{vv.version_num}</span>
                        <div>
                          <div className="msg-row">
                            <div className="msg">{vv.message ?? "—"}</div>
                            {vv.description && (
                              <button
                                type="button"
                                className={`desc-toggle${expandedVersionDescs.has(vv.id) ? " open" : ""}`}
                                onClick={() =>
                                  setExpandedVersionDescs((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(vv.id)) next.delete(vv.id);
                                    else next.add(vv.id);
                                    return next;
                                  })
                                }
                                title={expandedVersionDescs.has(vv.id) ? "Hide description" : "Show description"}
                                aria-expanded={expandedVersionDescs.has(vv.id)}
                                aria-label={`Toggle description for v${vv.version_num}`}
                              >
                                <Icon name="chevron-right" size={12} />
                              </button>
                            )}
                          </div>
                          {vv.description && expandedVersionDescs.has(vv.id) && (
                            <div className="ver-desc">{vv.description}</div>
                          )}
                          <div className="when">
                            {relativeTime(vv.created_at)}
                            {isCurrent ? " · current" : ""}
                            {vv.render_status !== "ok" ? ` · ${vv.render_status}` : ""}
                          </div>
                          {failed && (
                            <>
                              <div className="err">{vv.render_error ?? "render failed"}</div>
                              <button
                                className="btn ghost"
                                style={{ height: 26, fontSize: 11.5, padding: "0 8px", marginTop: 6 }}
                                onClick={() => void reRenderVersion(detail.visual.id, vv.version_num, vv.render_error)}
                              >
                                <Icon name="refresh" size={12} /> Re-render
                              </button>
                            </>
                          )}
                          {!isCurrent && !failed && (
                            <button
                              className="btn ghost"
                              style={{ height: 26, fontSize: 11.5, padding: "0 8px", marginTop: 6 }}
                              onClick={() => void revertToVersion(detail.visual.id, vv.version_num)}
                              title={`Make v${vv.version_num} the current version`}
                            >
                              <Icon name="refresh" size={12} /> Revert to v{vv.version_num}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="drawer-footer">
                {confirmArchive ? (
                  <div className="confirm-row">
                    <span className="muted">Archive this visual?</span>
                    <button className="btn ghost" onClick={() => setConfirmArchive(false)}>Cancel</button>
                    <button className="btn ghost danger" onClick={() => void archiveCurrentVisual()}>
                      <Icon name="archive" size={13} /> Confirm
                    </button>
                  </div>
                ) : detail.visual.archived_at ? (
                  <button
                    className="btn ghost"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={() => void restoreVisual(detail.visual.id)}
                  >
                    <Icon name="refresh" size={13} /> Restore
                  </button>
                ) : (
                  <button
                    className="btn ghost danger"
                    style={{ width: "100%", justifyContent: "center" }}
                    onClick={() => setConfirmArchive(true)}
                  >
                    <Icon name="archive" size={13} /> Archive
                  </button>
                )}
              </div>
            </aside>
          )}

          {/* Compose workbench (replaces SendToClaudeModal at S6 P12) */}
          {claudeMenuOpen && detail && (
            <WorkbenchHost
              visual={{
                id: detail.visual.id,
                title: detail.visual.title,
                fmt: detail.visual.type,
                ver: detail.visual.current_ver,
                thumb_url:
                  detail.visual.current_render_status === "ok" && detail.visual.thumb_version != null
                    ? `/thumbs/${detail.visual.id}/v${detail.visual.thumb_version}.png`
                    : null,
              }}
              templates={sendTemplates}
              projectId={detail.visual.project_id}
              onClose={() => setClaudeMenuOpen(false)}
              onCopy={(text) => void copyPromptText(text)}
              onSendToInbox={({ body, template_id, template_version_num }) =>
                void sendPromptToInbox({
                  visual_id: detail.visual.id,
                  body,
                  template_id,
                  template_version_num,
                })
              }
            />
          )}
        </div>
      </div>

      {/* Tag picker popover */}
      {tagPickerPos && (
        <TagPickerPopover
          pos={tagPickerPos}
          tags={tagAggregates}
          activeTags={activeTags}
          onToggle={(name) =>
            setActiveTags((cur) =>
              cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]
            )
          }
          onCreated={refreshAggregates}
          onClose={() => setTagPickerPos(null)}
          pushToast={pushToast}
        />
      )}

      {/* Download menu */}
      {downloadMenuOpen && detail && downloadMenuPos && (() => {
        const v = detail.visual;
        const ver = downloadVer ?? v.current_ver;
        const versions = detail.versions;
        const hasOkThumb =
          versions.find((x) => x.version_num === ver)?.render_status === "ok";
        const canSvg = v.type === "svg" || v.type === "dot" || v.type === "vega-lite" || v.type === "d2";
        const startDownload = (path: string) => {
          window.open(path, "_blank");
          setDownloadMenuOpen(false);
        };
        return (
          <div
            className="claude-menu download-menu"
            role="menu"
            style={{ position: "fixed", top: downloadMenuPos.top, right: downloadMenuPos.right }}
          >
            <div style={{ padding: "8px 16px 4px", borderBottom: "1px solid var(--rule)" }}>
              <label htmlFor="download-version-select" style={{ display: "block", fontSize: 11, color: "var(--text-mute)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                Version
              </label>
              <select
                id="download-version-select"
                value={ver}
                onChange={(e) => setDownloadVer(Number(e.target.value))}
                style={{ width: "100%" }}
              >
                {versions
                  .slice()
                  .sort((a, b) => b.version_num - a.version_num)
                  .map((x) => (
                    <option key={x.version_num} value={x.version_num}>
                      v{x.version_num}
                      {x.version_num === v.current_ver ? " (current)" : ""}
                    </option>
                  ))}
              </select>
            </div>
            <button onClick={() => startDownload(`/api/visuals/${v.id}/source?ver=${ver}`)}>
              <Icon name="download" size={12} /> <strong>Download source</strong>
              <span className="muted">Original file ({v.type})</span>
            </button>
            <button
              onClick={() => startDownload(`/thumbs/${v.id}/v${ver}.png?download=1`)}
              disabled={!hasOkThumb}
              title={hasOkThumb ? undefined : "Re-render the thumbnail first."}
            >
              <Icon name="download" size={12} /> <strong>Thumbnail (PNG)</strong>
              <span className="muted">{hasOkThumb ? "Rendered preview image" : "Render not ok"}</span>
            </button>
            {canSvg && (
              <button onClick={() => startDownload(`/api/visuals/${v.id}/render.svg?ver=${ver}`)}>
                <Icon name="download" size={12} /> <strong>Rendered SVG</strong>
                <span className="muted">Re-runs the renderer</span>
              </button>
            )}
            <div className="foot">
              <Icon name="bolt" size={11} /> Opens save dialog
            </div>
          </div>
        );
      })()}

      {/* Project export-zip chooser modal */}
      {exportZipFor && (
        <div className="modal-backdrop" onClick={() => setExportZipFor(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Export ${exportZipFor.name} as zip`}
            tabIndex={-1}
            ref={(el) => el?.focus()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setExportZipFor(null);
            }}
          >
            <h3 style={{ marginTop: 0 }}>Export "{exportZipFor.name}" as zip</h3>
            <p style={{ color: "var(--text-mute)", fontSize: 13.5, marginTop: 4 }}>
              Pick what to include in the archive.
            </p>
            <label style={{ display: "flex", gap: 8, padding: "8px 0", alignItems: "flex-start", cursor: "pointer" }}>
              <input
                type="radio"
                name="zip-mode"
                checked={exportZipMode === "current"}
                onChange={() => setExportZipMode("current")}
                style={{ marginTop: 4 }}
              />
              <span>
                <strong>Current versions only</strong>
                <span style={{ display: "block", color: "var(--text-mute)", fontSize: 12.5 }}>
                  Smaller zip — ships only each visual's current version.
                </span>
              </span>
            </label>
            <label style={{ display: "flex", gap: 8, padding: "8px 0", alignItems: "flex-start", cursor: "pointer" }}>
              <input
                type="radio"
                name="zip-mode"
                checked={exportZipMode === "all"}
                onChange={() => setExportZipMode("all")}
                style={{ marginTop: 4 }}
              />
              <span>
                <strong>All versions</strong>
                <span style={{ display: "block", color: "var(--text-mute)", fontSize: 12.5 }}>
                  Full archive — every saved version + thumb of every visual.
                </span>
              </span>
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setExportZipFor(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const url = `/api/projects/${encodeURIComponent(exportZipFor.name)}/export.zip?versions=${exportZipMode}`;
                  window.open(url, "_blank");
                  pushToast("info", `Exporting ${exportZipFor.name} (${exportZipMode}) — large projects may take a few seconds.`, "Export");
                  setExportZipFor(null);
                }}
              >
                <Icon name="download" size={14} /> Download zip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast stack — aria-live polite region for WS-driven notifications (Ia3) */}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === "error" ? " error" : t.kind === "success" ? " success" : ""}`} role="status">
            <span className="toast-icon" aria-hidden="true">
              <Icon name={t.kind === "error" ? "alert" : t.kind === "success" ? "check" : "info"} size={16} />
            </span>
            <div className="toast-body">
              <div className="label">{t.label ?? t.kind}</div>
              <div className="msg">{t.msg}</div>
            </div>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  void t.action!.onClick();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <div className="progress" style={{ animationDuration: `${t.ttl}ms` }} />
          </div>
        ))}
      </div>

      {/* Project context menu */}
      {projectMenu && (
        <div
          className="ctx-menu"
          style={{ left: projectMenu.x, top: projectMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setRenamingProject({ pid: projectMenu.pid, value: projectMenu.name });
              setProjectMenu(null);
            }}
          >
            Rename
          </button>
          <button
            onClick={() => {
              setMergeModal({ srcName: projectMenu.name });
              setProjectMenu(null);
            }}
          >
            Merge into…
          </button>
          <button
            onClick={() => {
              setExportZipFor({ name: projectMenu.name });
              setExportZipMode("current");
              setProjectMenu(null);
            }}
          >
            Export as zip…
          </button>
          <button
            className="danger"
            onClick={async () => {
              const target = projectMenu;
              setProjectMenu(null);
              const ok = await confirmModal({
                title: `Archive project "${target.name}"?`,
                body: "Archived projects are hidden from default lists. You can restore from the Archived view.",
                confirmLabel: "Archive",
                cancelLabel: "Cancel",
                danger: true,
              });
              if (ok) void archiveProj(target.pid, target.name);
            }}
          >
            Archive
          </button>
        </div>
      )}

      {/* Merge modal */}
      {mergeModal && projects && (
        <div className="modal-backdrop" onClick={() => setMergeModal(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Merge ${mergeModal.srcName} into another project`}
            tabIndex={-1}
            ref={(el) => el?.focus()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMergeModal(null);
            }}
          >
            <h2>Merge "{mergeModal.srcName}" into…</h2>
            <p className="muted">
              All visuals from "{mergeModal.srcName}" move to the destination. Source project is archived.
            </p>
            <ul className="merge-pick">
              {projects
                .filter((p) => p.name !== mergeModal.srcName)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => {
                        const src = mergeModal.srcName;
                        setMergeModal(null);
                        void mergeProj(src, p.name);
                      }}
                    >
                      <strong>{p.name}</strong> · {p.visual_count} visuals
                    </button>
                  </li>
                ))}
            </ul>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setMergeModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal primitive */}
      {confirmSpec && (
        <div
          className="modal-backdrop"
          onClick={() => {
            confirmSpec.resolve(false);
            setConfirmSpec(null);
          }}
        >
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                confirmSpec.resolve(false);
                setConfirmSpec(null);
              } else if (e.key === "Enter" && !confirmSpec.danger) {
                confirmSpec.resolve(true);
                setConfirmSpec(null);
              }
            }}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            <h2>{confirmSpec.title}</h2>
            {confirmSpec.body && <p className="muted">{confirmSpec.body}</p>}
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => {
                  confirmSpec.resolve(false);
                  setConfirmSpec(null);
                }}
              >
                {confirmSpec.cancelLabel ?? "Cancel"}
              </button>
              <button
                className={`btn ${confirmSpec.danger ? "ghost danger" : "primary"}`}
                onClick={() => {
                  confirmSpec.resolve(true);
                  setConfirmSpec(null);
                }}
                autoFocus={!confirmSpec.danger}
              >
                {confirmSpec.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cheatsheet overlay (?) */}
      {showCheatsheet && (
        <div className="modal-backdrop" onClick={() => setShowCheatsheet(false)}>
          <div
            className="cheatsheet"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            <header className="cheatsheet-head">
              <h2>Keyboard shortcuts</h2>
              <button
                className="icon-btn"
                aria-label="Close (Esc)"
                title="Close (Esc)"
                onClick={() => setShowCheatsheet(false)}
              >
                <Icon name="x" size={16} />
              </button>
            </header>
            <div className="cheatsheet-grid">
              <section>
                <h3>Library</h3>
                <div className="rows">
                  <span className="keys"><kbd>/</kbd><span className="verbal">or</span><kbd>f</kbd></span>
                  <span className="desc">Focus search / filter</span>
                  <span className="keys"><kbd>⌘</kbd><span className="sep">+</span><kbd>K</kbd></span>
                  <span className="desc">Reset search</span>
                  <span className="keys"><kbd>j</kbd><span className="verbal">/</span><kbd>k</kbd></span>
                  <span className="desc">Navigate cards</span>
                  <span className="keys"><kbd>Enter</kbd></span>
                  <span className="desc">Open focused card</span>
                  <span className="keys"><kbd>s</kbd></span>
                  <span className="desc">Star focused card</span>
                  <span className="keys"><kbd>b</kbd></span>
                  <span className="desc">Toggle sidebar (expanded ↔ rail)</span>
                  <span className="keys"><kbd>?</kbd></span>
                  <span className="desc">Toggle this cheatsheet</span>
                  <span className="keys"><kbd>Esc</kbd></span>
                  <span className="desc">Close menu / clear / blur</span>
                </div>
              </section>
              <section>
                <h3>Filtering</h3>
                <div className="rows">
                  <span className="keys"><kbd>⌘</kbd><span className="sep">+</span><kbd>⌫</kbd></span>
                  <span className="desc">Clear all filters</span>
                </div>
              </section>
              <section>
                <h3>Drawer</h3>
                <div className="rows">
                  <span className="keys"><kbd>Esc</kbd></span>
                  <span className="desc">Close drawer</span>
                  <span className="keys mouse">click thumbnail</span>
                  <span className="desc">Open preview in new tab</span>
                  <span className="keys mouse">click version row</span>
                  <span className="desc">Open that version</span>
                </div>
              </section>
              <section>
                <h3>Compare</h3>
                <div className="rows">
                  <span className="keys mouse">swap button</span>
                  <span className="desc">Flip A ↔ B</span>
                  <span className="keys mouse">overlay slider</span>
                  <span className="desc">Live opacity</span>
                  <span className="keys mouse">+ pane B</span>
                  <span className="desc">Add second pane (single mode)</span>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Clipboard fallback */}
      {copyFallback !== null && (
        <div className="modal-backdrop" onClick={() => setCopyFallback(null)}>
          <div
            className="modal copy-fallback"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setCopyFallback(null);
            }}
            tabIndex={-1}
            ref={(el) => el?.focus()}
          >
            <h2>Copy this prompt</h2>
            <p className="muted">
              Browser blocked clipboard write. Select all + copy manually.
            </p>
            <textarea
              className="copy-fallback-text"
              aria-label="Prompt to copy"
              readOnly
              value={copyFallback}
              rows={6}
              onFocus={(e) => e.currentTarget.select()}
              ref={(el) => el?.select()}
            />
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setCopyFallback(null)}>
                Close
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(copyFallback);
                    pushToast("info", "Prompt copied — paste into agent.", "Talk with agent");
                    setCopyFallback(null);
                    setClaudeMenuOpen(false);
                  } catch {
                    pushToast("error", "Clipboard still blocked — select the text + Cmd/Ctrl-C.");
                  }
                }}
              >
                Try copy again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
