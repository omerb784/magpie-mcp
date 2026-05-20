export const DASHBOARD_EMPTY = {
  title: "Magpie is empty",
  body:
    "Magpie organizes the visuals Claude makes — mockups, diagrams, charts, docs. It doesn't generate them; Claude does.",
  steps: [
    {
      label: "Wire it up",
      detail: "Run `npx magpie-mcp --print-config` and paste the snippet into Claude Desktop's MCP config.",
    },
    {
      label: "Ask Claude to mock something",
      detail: "Try: \"Mock a settings page in onboarding\" or \"Sketch the auth flow as a diagram.\"",
    },
  ],
  snippetHeading: "MCP config snippet",
};

export function projectEmpty(name: string): string {
  return `Ask Claude to add the first visual to "${name}". e.g. "Mock a settings page in ${name}".`;
}

export function searchEmpty(query: string): { msg: string; clearLabel: string } {
  const msg = query
    ? `Nothing matches "${query}".`
    : "No visuals match the current filters.";
  return { msg, clearLabel: "Clear all filters" };
}

export const ARCHIVED_PROJECTS_EMPTY =
  "Nothing archived. Archived projects show up here when you archive one.";

export const STARRED_EMPTY = "Nothing starred. Click the ☆ on a card to mark it.";

export const EMPTY_STATE_COPY = {
  archived: {
    tag: "an archive, not a graveyard",
    title: "Nothing archived yet",
    body: "Archive visuals you want to keep for posterity but don't need cluttering your active set. They stay searchable.",
    helperKbd: "click the ⋯ menu on a project to archive",
  },
  starred: {
    tag: "the keepers",
    title: "Your starred visuals will live here",
    body: "Star anything you'd want to come back to — final mocks, reference pieces, or work that just turned out well.",
    helperKbd: "press s on any focused card to star",
  },
  search: {
    tag: "a wider net",
    body: "Magpie searches titles, content, and tags. Try a different spelling, or browse by project from the sidebar.",
    helperKbd: "press Esc to clear",
  },
} as const;

export const KEYBOARD_HINTS: { key: string; what: string }[] = [
  { key: "/", what: "search" },
  { key: "Esc", what: "close" },
  { key: "j/k", what: "navigate" },
  { key: "s", what: "star" },
];

export const KEYBOARD_HINT_CMDK = { key: "⌘K", what: "search reset" };
