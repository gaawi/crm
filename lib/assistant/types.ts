/**
 * The daily campaign assistant, as the client receives it (no "server-only":
 * safe to import from client components). Dates are 'YYYY-MM-DD', timestamps
 * ISO strings.
 */

export type AssistantActionKind = "email" | "call" | "whatsapp" | "task";
export type AssistantActionStatus = "open" | "done" | "postponed" | "dismissed";
/** 1 high · 2 normal · 3 low. */
export type AssistantPriority = 1 | 2 | 3;

export const ASSISTANT_ACTION_KINDS: AssistantActionKind[] = ["email", "call", "whatsapp", "task"];

/** A comment on a suggested action: the owner's, or the assistant's answer. */
export interface AssistantActionComment {
  at: string;
  by: "owner" | "assistant";
  text: string;
}

/** Longest campaign brief (the owner's instructions, lists and dates included). */
export const MAX_BRIEF = 20_000;

/** Longest comment the owner can write on an action. */
export const MAX_ACTION_COMMENT = 2000;

/** Most emails the routine may propose for one campaign in one call. */
export const MAX_EMAILS_PER_CALL = 10;

/** When the daily review runs (it writes the new versions the owner asked for). */
export const ASSISTANT_REVIEW_TIMES = "7:00 / 16:00 New York";

/** Default "Postpone": a week. */
export const DEFAULT_POSTPONE_DAYS = 7;

export interface AssistantAction {
  id: string;
  projectId: string;
  projectName: string;
  opportunityId: string | null;
  /** Venue / organization of the row, else the row's title. */
  rowName: string | null;
  contact: { id: string; displayName: string; phone: string | null; whatsapp: string | null; photoUrl?: string | null } | null;
  kind: AssistantActionKind;
  title: string;
  reason: string | null;
  priority: AssistantPriority;
  status: AssistantActionStatus;
  postponedUntil: string | null;
  draftId: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Oldest first. The assistant answers on its next run while the last one is the owner's. */
  comments: AssistantActionComment[];
}

/** A sheet's assistant settings. */
export interface AssistantSettings {
  active: boolean;
  brief: string | null;
  lastRunAt: string | null;
}
