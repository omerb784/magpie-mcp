import { useEffect } from "react";
import { Icon } from "../Icon";
import { Crumb } from "./Crumb";
import { TemplateRow } from "./TemplateRow";
import { CmdKPalette } from "./CmdKPalette";
import { Inputs } from "./Inputs";
import { Body } from "./Body";
import { Preview } from "./Preview";
import { Examples } from "./Examples";
import { StatusStrip } from "./StatusStrip";
import type { WorkbenchProps } from "./types";

const KBD_SEND = "⌘⏎";

export function Workbench(props: WorkbenchProps) {
  const {
    mode = "panel",
    compareMode = false,
    showSavedDot = false,
    template = null,
    examples = [],
    visual,
    varValues = {},
    activeVarPill,
    verSources,
    verSourceKey,
    versionMenuOpen = false,
    versionRows,
    cmdkOpen = false,
    paletteEntries = [],
    previewCollapsed = false,
    examplesCollapsed = true,
    lintWarnings = [],
    lintStripExpanded = false,
    freeBody = "",
    onChangeFreeBody,
    onClose,
    onSend,
    onCopy,
    onToggleVersionMenu,
    onPickVersion,
    onOpenPalette,
    onClosePalette,
    onPickPaletteEntry,
    onChangeVar,
    onFocusVar,
    onPickVerSource,
    onTogglePreview,
    onToggleExamples,
    onAddExample,
    onChangeExample,
    onRemoveExample,
    onToggleLintStrip,
  } = props;

  const sendEnabled = !!template || freeBody.trim().length > 0;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (cmdkOpen) onClosePalette?.();
        else onOpenPalette?.();
        return;
      }
      if (mod && (e.key === "Enter" || e.code === "Enter")) {
        if (!sendEnabled) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        onSend?.();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cmdkOpen, sendEnabled, onOpenPalette, onClosePalette, onSend]);

  const isNarrow = mode === "narrow";
  const panelWidth = isNarrow ? "calc(100% - 64px)" : 640;

  const crumb = (
    <Crumb
      visual={visual}
      compareMode={compareMode}
      versionMenuOpen={versionMenuOpen}
      versionRows={versionRows}
      onToggleVersionMenu={onToggleVersionMenu}
      onPickVersion={onPickVersion}
    />
  );
  // S7 P3.D — surface the active template's scope as a chip on the row.
  // Pulled from the palette entry that matches the current template id so
  // archive-state derivations stay in one place (host paletteScopeFor).
  const activeScope = template
    ? paletteEntries.find((e) => e.id === template.id)?.scope
    : undefined;
  const templateRow = (
    <TemplateRow
      template={template}
      exampleCount={examples.length}
      scope={activeScope}
      onOpenPalette={onOpenPalette}
    />
  );
  const inputs = (
    <Inputs
      template={template}
      values={varValues}
      activeVarPill={activeVarPill}
      onChangeVar={onChangeVar}
      onFocusVar={onFocusVar}
    />
  );
  // S7 P7.B (F10) — diff feature deleted. Body always renders.
  const bodyOrDiff = (
    <Body
      template={template}
      verSources={verSources}
      verSourceKey={verSourceKey}
      activeVarPill={activeVarPill}
      freeBody={freeBody}
      onChangeFreeBody={onChangeFreeBody}
      onPickVerSource={onPickVerSource}
    />
  );
  const preview = (
    <Preview
      template={template}
      visual={visual}
      varValues={varValues}
      examples={examples}
      collapsed={previewCollapsed}
      activeVarPill={activeVarPill}
      onToggle={onTogglePreview}
    />
  );
  const examplesNode = template ? (
    <Examples
      examples={examples}
      collapsed={examplesCollapsed}
      onToggle={onToggleExamples}
      onAdd={onAddExample}
      onChange={onChangeExample}
      onRemove={onRemoveExample}
    />
  ) : null;

  return (
    <aside className={`wb wb-${mode}`} style={{ width: panelWidth }}>
      <WBHeader
        compareMode={compareMode}
        showSavedDot={showSavedDot}
        onClose={onClose}
      />
      <div className="wb-scroll">
        {crumb}
        {templateRow}
        {inputs}
        {bodyOrDiff}
        {preview}
        {examplesNode}
      </div>
      {cmdkOpen && onClosePalette && (
        <CmdKPalette
          entries={paletteEntries}
          onPick={(entry) => {
            onPickPaletteEntry?.(entry);
            onClosePalette();
          }}
          onClose={onClosePalette}
        />
      )}
      <StatusStrip
        template={template}
        varValues={varValues}
        warnings={lintWarnings}
        freeBody={freeBody}
        expanded={lintStripExpanded}
        onToggleExpanded={onToggleLintStrip}
        onFocusMissing={onFocusVar}
      />
      <WBFooter enabled={sendEnabled} onSend={onSend} onCopy={onCopy} />
    </aside>
  );
}

function WBHeader({
  compareMode,
  showSavedDot,
  onClose,
}: {
  compareMode: boolean;
  showSavedDot: boolean;
  onClose?: () => void;
}) {
  const label = compareMode ? "compose · compare" : "compose";
  return (
    <header className="wb-head">
      <div className="wb-head-l">
        <span className="wb-mono-label">{label}</span>
        {showSavedDot && (
          <span className="wb-saved" title="autosaved to localStorage">
            <span className="wb-saved-dot" />
            <span>saved</span>
          </span>
        )}
      </div>
      <div className="wb-head-r">
        <button
          className="icon-btn"
          type="button"
          title="close (Esc)"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </header>
  );
}

function WBFooter({
  enabled,
  onSend,
  onCopy,
}: {
  enabled: boolean;
  onSend?: () => void;
  onCopy?: () => void;
}) {
  return (
    <footer className="wb-foot">
      <button
        className="btn"
        type="button"
        disabled={!enabled}
        style={enabled ? undefined : { opacity: 0.5, cursor: "not-allowed" }}
        onClick={onCopy}
      >
        <Icon name="copy" size={13} />
        <span>copy</span>
      </button>
      <span style={{ flex: 1 }} />
      <span className="wb-foot-hint">
        <span className="kbd">{KBD_SEND}</span> to send
      </span>
      <button
        className="btn primary"
        type="button"
        disabled={!enabled}
        onClick={onSend}
      >
        <Icon name="send" size={13} />
        <span>send to inbox</span>
      </button>
    </footer>
  );
}
