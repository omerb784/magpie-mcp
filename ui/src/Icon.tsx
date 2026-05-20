import type { SVGProps } from "react";

export type IconName =
  | "search"
  | "sidebar"
  | "grid"
  | "list"
  | "sort"
  | "moon"
  | "sun"
  | "star"
  | "star-fill"
  | "folder"
  | "archive"
  | "x"
  | "plus"
  | "chevron-down"
  | "chevron-right"
  | "external"
  | "compare"
  | "send"
  | "refresh"
  | "tag"
  | "html"
  | "diagram"
  | "vector"
  | "markdown"
  | "graph"
  | "chart"
  | "flow"
  | "kebab"
  | "calendar"
  | "filter"
  | "bolt"
  | "eye"
  | "download"
  | "zip"
  | "check"
  | "info"
  | "alert"
  | "question"
  | "expand"
  | "copy"
  | "diff-branch"
  | "brace"
  | "template";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.6,
  fill = "none",
  ...rest
}: IconProps) {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill,
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...rest,
  };
  switch (name) {
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "sidebar":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.4" />
          <rect x="14" y="3" width="7" height="7" rx="1.4" />
          <rect x="3" y="14" width="7" height="7" rx="1.4" />
          <rect x="14" y="14" width="7" height="7" rx="1.4" />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="4" cy="6" r="0.8" fill="currentColor" />
          <circle cx="4" cy="12" r="0.8" fill="currentColor" />
          <circle cx="4" cy="18" r="0.8" fill="currentColor" />
        </svg>
      );
    case "sort":
      return (
        <svg {...common}>
          <path d="M3 6h13M3 12h9M3 18h5" />
          <path d="m17 14 4 4 4-4" transform="translate(-3 0)" />
        </svg>
      );
    case "moon":
      return (
        <svg {...common}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      );
    case "sun":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2Z" />
        </svg>
      );
    case "star-fill":
      return (
        <svg {...common} fill="currentColor">
          <path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2Z" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5Z" />
        </svg>
      );
    case "archive":
      return (
        <svg {...common}>
          <rect x="2.5" y="4" width="19" height="4.5" rx="1" />
          <path d="M4 8.5V20h16V8.5" />
          <path d="M10 13h4" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...common}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      );
    case "compare":
      return (
        <svg {...common}>
          <path d="M12 3v18" />
          <path d="M5 7h4v10H5z" />
          <path d="M15 5h4v14h-4z" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="m22 2-7 20-4-9-9-4 20-7Z" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      );
    case "tag":
      return (
        <svg {...common}>
          <path d="M20.59 13.41 13 21l-9-9V4h8l8.59 8.59a2 2 0 0 1 0 2.82Z" />
          <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
        </svg>
      );
    case "html":
      return (
        <svg {...common}>
          <path d="m4 4 1.5 16 6.5 2 6.5-2L20 4Z" />
          <path d="M8 8h8l-.5 4-3.5 1-3.5-1L8 11" />
        </svg>
      );
    case "diagram":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="15" width="6" height="6" rx="1" />
          <path d="M9 6h3a3 3 0 0 1 3 3v6" />
        </svg>
      );
    case "vector":
      return (
        <svg {...common}>
          <path d="m12 3-9 9 9 9 9-9-9-9Z" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case "markdown":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 15V9l2.5 3L12 9v6" />
          <path d="M16 9v6m0 0-1.5-1.5M16 15l1.5-1.5" />
        </svg>
      );
    case "graph":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="18" cy="6" r="2.2" />
          <circle cx="12" cy="18" r="2.2" />
          <path d="M7.5 7.5 10.7 16M16.5 7.5 13.3 16M8.2 6h7.6" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M4 20V4M4 20h16" />
          <rect x="7" y="12" width="2.6" height="6" />
          <rect x="11" y="8" width="2.6" height="10" />
          <rect x="15" y="14" width="2.6" height="4" />
        </svg>
      );
    case "flow":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="6" height="5" rx="1" />
          <rect x="15" y="4" width="6" height="5" rx="1" />
          <rect x="9" y="15" width="6" height="5" rx="1" />
          <path d="M9 6.5h6M6 9v3a2 2 0 0 0 2 2h1M18 9v3a2 2 0 0 1-2 2h-1" />
        </svg>
      );
    case "kebab":
      return (
        <svg {...common}>
          <circle cx="12" cy="6" r="1.2" fill="currentColor" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
          <circle cx="12" cy="18" r="1.2" fill="currentColor" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );
    case "filter":
      return (
        <svg {...common}>
          <path d="M3 5h18l-7 9v6l-4-2v-4Z" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...common}>
          <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 4v11" />
          <path d="m7 11 5 5 5-5" />
          <path d="M5 19h14" />
        </svg>
      );
    case "zip":
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M11 3v2h2V7h-2v2h2v2h-2v2h2v2h-2v2" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M5 12.5 10 17.5 19.5 8" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.5" r="0.9" fill="currentColor" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 3 22 20H2Z" />
          <path d="M12 10v5" />
          <circle cx="12" cy="17.5" r="0.9" fill="currentColor" />
        </svg>
      );
    case "question":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14" />
          <circle cx="12" cy="17" r="0.7" fill="currentColor" />
        </svg>
      );
    case "expand":
      return (
        <svg {...common}>
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "diff-branch":
      return (
        <svg {...common}>
          <path d="M6 3v12" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
          <circle cx="18" cy="6" r="3" />
        </svg>
      );
    case "brace":
      return (
        <svg {...common}>
          <path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" />
          <path d="M16 21h1a2 2 0 0 0 2-2v-4a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
        </svg>
      );
    case "template":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="4" rx="1" />
          <rect x="3" y="11" width="9" height="10" rx="1" />
          <rect x="14" y="11" width="7" height="4" rx="1" />
          <rect x="14" y="17" width="7" height="4" rx="1" />
        </svg>
      );
    default:
      return null;
  }
}

/* token-drift-allow: user-tag swatch palette, distinct from brand --fmt-* slots
   on purpose. These mark Owner-authored tag categories ("dashboard", "wip",
   "diagram"…), not Magpie chrome. Promoted to a CSS custom-property family is
   v0.9.3 work — see backlog. Until then, allowlist this table. */
export const TAG_COLORS: Record<string, string> = {
  dashboard: "#d97757",
  "dark-mode": "#6a9bcc",
  darkmode: "#6a9bcc",
  minimal: "#788c5d",
  wip: "#a89455",
  diagram: "#9c7bb8",
  icon: "#c08fa3",
};

/* token-drift-allow: fallback swatch for un-categorised user tags. */
export function tagColor(name: string): string {
  const key = name.toLowerCase();
  return TAG_COLORS[key] ?? "#b0aea5";
}
