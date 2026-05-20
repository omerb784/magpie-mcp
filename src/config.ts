import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HOME = homedir();

const ROOT = process.env.MAGPIE_HOME ?? join(HOME, ".magpie");
const CONTENT_ROOT = resolve(process.env.MAGPIE_CONTENT_ROOT ?? process.cwd());
const PORT_ENV = process.env.MAGPIE_PORT;
const BIND_ENV = process.env.MAGPIE_BIND;
const CHROME_ENV = process.env.MAGPIE_CHROME_PATH;

export const config = {
  home: ROOT,
  dbPath: join(ROOT, "db.sqlite"),
  blobsRoot: join(ROOT, "blobs"),
  lastPortFile: join(ROOT, "last-port"),
  defaultPort: Number(PORT_ENV ?? 3737),
  maxContentBytes: 5 * 1024 * 1024,
  renderTimeoutMs: 10_000,
  viewport: { width: 1280, height: 800 } as const,
  chromePath: CHROME_ENV,
  bind: BIND_ENV ?? "127.0.0.1",
  contentRoot: CONTENT_ROOT,
} as const;

export const VERSION = "1.0.0";
export const INSTRUCTIONS_VERSION = "11";

export const CONFIG_SNIPPET_CODE = `# Claude Code — project-level .mcp.json (in repo root)
{
  "mcpServers": {
    "magpie": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "magpie-mcp"]
    }
  }
}

# Optional: pin storage to a specific directory by adding env:
#   "env": { "MAGPIE_HOME": "/absolute/path" }
`;

export const CONFIG_SNIPPET_DESKTOP = `# Claude Desktop — claude_desktop_config.json
{
  "mcpServers": {
    "magpie": {
      "command": "npx",
      "args": ["-y", "magpie-mcp"]
    }
  }
}

# Optional: pin storage to a specific directory by adding env:
#   "env": { "MAGPIE_HOME": "/absolute/path" }
`;

export const CONFIG_SNIPPETS = `${CONFIG_SNIPPET_CODE}\n${CONFIG_SNIPPET_DESKTOP}`;
