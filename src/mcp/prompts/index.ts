import { a11yAuditPrompt } from "./a11y_audit.js";
import { addDataPrompt } from "./add_data.js";
import { darkModePortPrompt } from "./dark_mode_port.js";
import { explainPrompt } from "./explain.js";
import { iteratePrompt } from "./iterate.js";
import { responsiveCheckPrompt } from "./responsive_check.js";
import { simplifyPrompt } from "./simplify.js";
import type { Prompt } from "./types.js";
import { variantsPrompt } from "./variants.js";

export const PROMPTS: Prompt[] = [
  // S4 builtins.
  iteratePrompt,
  variantsPrompt,
  explainPrompt,
  // S5 P4.A — Magpie-specific verbs.
  a11yAuditPrompt,
  responsiveCheckPrompt,
  darkModePortPrompt,
  simplifyPrompt,
  addDataPrompt,
];

export const PROMPTS_BY_NAME: Record<string, Prompt> = Object.fromEntries(
  PROMPTS.map((p) => [p.name, p])
);

export type { Prompt, PromptArg } from "./types.js";
