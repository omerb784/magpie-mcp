import { Icon } from "../Icon";
import type {
  CompareVisual,
  WorkbenchVisual,
} from "./types";

const FORMAT_DOT_SIZE = 6;

interface MiniThumbProps {
  fmt: string;
  size?: number;
  ring?: string;
  thumbUrl?: string | null;
}

function MiniThumb({ fmt, size = 28, ring, thumbUrl }: MiniThumbProps) {
  // S7 P7.D (F12) — show the visual's real thumbnail when available;
  // fall back to the format-colored box on missing / error. We can't
  // catch <img> 404s without state, so a load error sets a flag that
  // hides the img and shows the box variant via CSS.
  return (
    <div
      className="wb-mini-thumb"
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-sm)",
        background: "var(--thumb-bg)",
        border: "1px solid var(--hr)",
        boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        position: "relative",
      }}
      data-fmt={fmt}
    >
      {thumbUrl && (
        <img
          src={thumbUrl}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
    </div>
  );
}

function FormatDot({ fmt, size = FORMAT_DOT_SIZE }: { fmt: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `var(--fmt-${fmt})`,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

export interface VersionMenuRow {
  versionNum: number;
  label: string;
  when?: string;
}

interface VersionMenuProps {
  currentVer: number;
  rows: VersionMenuRow[];
  onPick?: (versionNum: number) => void;
}

function VersionMenu({ currentVer, rows, onPick }: VersionMenuProps) {
  return (
    <div className="wb-vermenu" role="menu">
      <div className="wb-vermenu-head">
        <span className="wb-mono-label">versions</span>
      </div>
      {rows.map((row) => {
        const isCurrent = row.versionNum === currentVer;
        return (
          <button
            key={row.versionNum}
            type="button"
            className={`wb-vermenu-row ${isCurrent ? "current" : ""}`}
            onClick={() => onPick?.(row.versionNum)}
          >
            <span
              style={{
                fontFamily: "var(--mono-font)",
                fontWeight: 500,
                fontSize: "var(--fs-sm)",
              }}
            >
              v{row.versionNum}
            </span>
            <span
              style={{
                flex: 1,
                textAlign: "left",
                color: "var(--text-mute)",
                fontSize: "var(--fs-sm)",
              }}
            >
              {row.label}
            </span>
            {row.when && (
              <span
                style={{
                  fontFamily: "var(--mono-font)",
                  fontSize: "var(--fs-2xs)",
                  color: "var(--text-subtle)",
                  letterSpacing: "var(--tracking-mono-tight)",
                }}
              >
                {row.when}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface VersionChipProps {
  ver: number;
  open: boolean;
  rows?: VersionMenuRow[];
  onToggle?: () => void;
  onPick?: (versionNum: number) => void;
}

export function VersionChip({
  ver,
  open,
  rows = [],
  onToggle,
  onPick,
}: VersionChipProps) {
  return (
    <div className={`wb-verchip ${open ? "open" : ""}`}>
      <button
        type="button"
        className="wb-verchip-btn"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span style={{ fontFamily: "var(--mono-font)", fontWeight: 500 }}>
          v{ver}
        </span>
        <Icon
          name={open ? "chevron-down" : "chevron-down"}
          size={11}
          style={{ opacity: 0.6 }}
        />
      </button>
      {open && (
        <VersionMenu
          currentVer={ver}
          rows={rows}
          onPick={onPick}
        />
      )}
    </div>
  );
}

interface CrumbProps {
  visual: WorkbenchVisual | CompareVisual;
  compareMode: boolean;
  versionMenuOpen: boolean;
  versionRows?: VersionMenuRow[];
  onToggleVersionMenu?: () => void;
  onPickVersion?: (versionNum: number) => void;
}

function isCompareVisual(
  v: WorkbenchVisual | CompareVisual,
): v is CompareVisual {
  return (v as CompareVisual).a !== undefined;
}

export function Crumb(props: CrumbProps) {
  const {
    visual,
    compareMode,
    versionMenuOpen,
    versionRows,
    onToggleVersionMenu,
    onPickVersion,
  } = props;

  if (compareMode && isCompareVisual(visual)) {
    return (
      <div className="wb-crumb wb-crumb-compare">
        <div className="wb-crumb-twothumbs">
          <MiniThumb fmt={visual.fmt} size={26} ring="var(--terra-deep)" />
          <MiniThumb fmt={visual.fmt} size={26} ring="var(--sky)" />
        </div>
        <div className="wb-crumb-text">
          <span className="wb-crumb-title">{visual.title}</span>
          <span className="wb-crumb-meta">
            <span
              style={{
                color: "var(--terra-deep)",
                fontFamily: "var(--mono-font)",
                fontSize: "var(--fs-2xs)",
                letterSpacing: "var(--tracking-mono-tight)",
              }}
            >
              v{visual.a.ver}
            </span>
            <span style={{ color: "var(--text-subtle)" }}>↔</span>
            <span
              style={{
                color: "var(--sky)",
                fontFamily: "var(--mono-font)",
                fontSize: "var(--fs-2xs)",
                letterSpacing: "var(--tracking-mono-tight)",
              }}
            >
              v{visual.b.ver}
            </span>
          </span>
        </div>
        <span
          className="wb-current-chip"
          title="current version"
        >
          current · v{visual.current.ver}
        </span>
      </div>
    );
  }

  const single = visual as WorkbenchVisual;
  return (
    <div className="wb-crumb">
      <MiniThumb fmt={single.fmt} size={28} thumbUrl={single.thumb_url ?? null} />
      <div className="wb-crumb-text">
        <span className="wb-crumb-title">{single.title}</span>
        <span className="wb-crumb-meta">
          <FormatDot fmt={single.fmt} />
          <span
            style={{
              fontFamily: "var(--mono-font)",
              fontSize: "var(--fs-2xs)",
              letterSpacing: "var(--tracking-mono-tight)",
              color: "var(--text-mute)",
            }}
          >
            {single.fmt}
          </span>
        </span>
      </div>
      <VersionChip
        ver={single.ver}
        open={versionMenuOpen}
        rows={versionRows ?? []}
        onToggle={onToggleVersionMenu}
        onPick={onPickVersion}
      />
    </div>
  );
}
