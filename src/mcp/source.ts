export const SOURCE_VALUES = [
  "stitch",
  "figma",
  "mermaid-chart",
  "svgmaker",
  "icons8",
  "claude",
  "manual",
] as const;

export type Source = (typeof SOURCE_VALUES)[number];
