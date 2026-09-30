import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

let client: Anthropic | undefined;

/** Shared Anthropic client (reads ANTHROPIC_API_KEY lazily). */
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

export function model(): string {
  return env.anthropicModel;
}

/**
 * Server-side refusal fallback (routes a declined request to Anthropic's
 * recommended model for that refusal category). Beta header + body param.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
