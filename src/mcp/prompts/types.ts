import type { z } from "zod";

export interface PromptArg {
  name: string;
  description: string;
  required?: boolean;
}

export interface Prompt<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  arguments: PromptArg[];
  argsSchema: S;
  render(args: z.infer<S>): string;
}
