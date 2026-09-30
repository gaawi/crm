import "server-only";
import type { z } from "zod";

/**
 * CRM tools for Claude, defined once and used by both the in-app assistant
 * (/api/assistant) and the MCP endpoint (/api/mcp).
 *
 * Each tool: a snake_case name, a description written for the model, a zod
 * input schema (also rendered to JSON Schema for the API), and a handler that
 * returns JSON-serializable data. Handlers call lib/queries/* and lib/sync/*.
 * Results are compact: truncate long bodies, cap list sizes, ISO dates.
 */

export interface CrmTool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: Schema;
  /** True for tools that change data (update_contact, create_gmail_draft). */
  mutates: boolean;
  run: (input: z.infer<Schema>, context: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  /** 'YYYY-MM-DD' in the owner's timezone. */
  today: string;
  timezone: string;
}

/** All tools, in a stable order (the order is part of the prompt-cache prefix). */
export function getCrmTools(): CrmTool[] {
  throw new Error("TODO");
}

/** JSON Schema (draft 2020-12, additionalProperties: false) for a tool's input. */
export function toolInputJsonSchema(tool: CrmTool): Record<string, unknown> {
  void tool;
  throw new Error("TODO");
}

/**
 * Validate input with the tool's schema and run it. Never throws: returns
 * { ok: false, error } for unknown tools, invalid input or handler errors.
 */
export async function runCrmTool(
  name: string,
  input: unknown,
  context: ToolContext,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  void name;
  void input;
  void context;
  throw new Error("TODO");
}
