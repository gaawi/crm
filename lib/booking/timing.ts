/**
 * When to follow up on an unanswered email, and what the last touch with a
 * booking row was (client and server).
 */
import { FOLLOW_UP_OVERDUE_DAYS, FOLLOW_UP_WAIT_DAYS } from "@/lib/constants";
import { addDays, daysBetween, toISODate } from "@/lib/dates";
import type { ActivityKind, CallOutcome, OpportunityStage } from "@/lib/types";

export type FollowUpState = "wait" | "ready" | "overdue";

export interface FollowUpTiming {
  /** wait: < 5 days since the email; ready: 5–10 days; overdue: more than 10 ("No reply"). */
  state: FollowUpState;
  /** Whole days since the unanswered email (owner's calendar days). */
  days: number;
  /** Days left before following up (0 unless state is "wait"). */
  waitDays: number;
  /** 'YYYY-MM-DD': the email's day + FOLLOW_UP_WAIT_DAYS. */
  suggestedDate: string;
}

/** Timing of a follow-up after my email `awaitingReplySince` (null when there is nothing to wait for). */
export function followUpTiming(input: {
  awaitingReplySince: Date | string | null | undefined;
  /** 'YYYY-MM-DD' in `timezone`. */
  today: string;
  timezone: string;
}): FollowUpTiming | null {
  if (!input.awaitingReplySince) return null;
  const sentOn = toISODate(new Date(input.awaitingReplySince), input.timezone);
  const days = Math.max(0, daysBetween(sentOn, input.today));
  const state: FollowUpState = days < FOLLOW_UP_WAIT_DAYS ? "wait" : days <= FOLLOW_UP_OVERDUE_DAYS ? "ready" : "overdue";
  return {
    state,
    days,
    waitDays: state === "wait" ? FOLLOW_UP_WAIT_DAYS - days : 0,
    suggestedDate: addDays(sentOn, FOLLOW_UP_WAIT_DAYS),
  };
}

/** Rows whose follow-up timing matters: Contacted and Offer sent. */
export function isAwaitingStage(stage: OpportunityStage): boolean {
  return stage === "contacted" || stage === "proposal";
}

export function isOpenStage(stage: OpportunityStage): boolean {
  return stage !== "won" && stage !== "lost";
}

/** The parts of a row the timing helpers read (SheetRow satisfies it). */
export interface TimingRow {
  stage: OpportunityStage;
  followUpAt: string | null;
  contact: {
    awaitingReplySince: string | Date | null;
    lastInboundAt: string | Date | null;
    lastOutboundAt: string | Date | null;
  } | null;
  lastActivity: { kind: ActivityKind; outcome: CallOutcome | null; occurredAt: string | Date } | null;
}

/** followUpTiming for a row: only Contacted / Offer sent rows waiting on an answer. */
export function rowFollowUpTiming(row: TimingRow, today: string, timezone: string): FollowUpTiming | null {
  if (!isAwaitingStage(row.stage)) return null;
  return followUpTiming({ awaitingReplySince: row.contact?.awaitingReplySince, today, timezone });
}

/** Open row with a follow-up date today or earlier (the sheet's "Follow-ups due"). */
export function isFollowUpDue(row: Pick<TimingRow, "stage" | "followUpAt">, today: string): boolean {
  return Boolean(row.followUpAt && row.followUpAt <= today && isOpenStage(row.stage));
}

/** Waiting on them for more than FOLLOW_UP_OVERDUE_DAYS (the sheet's "No reply"). */
export function isNoReply(row: TimingRow, today: string, timezone: string): boolean {
  return rowFollowUpTiming(row, today, timezone)?.state === "overdue";
}

export type LastTouch =
  | { type: "awaiting"; at: string }
  | { type: "email_in"; at: string }
  | { type: "email_out"; at: string }
  | { type: "activity"; at: string; kind: Exclude<ActivityKind, "status">; outcome: CallOutcome | null };

const iso = (value: string | Date) => new Date(value).toISOString();

/**
 * The most recent touch: the latest of my last email, their last email and
 * the last logged activity (a note counts too). An unanswered email of mine
 * reads "awaiting" ("Waiting on them · 6 days"). Null when nothing happened.
 */
export function lastTouch(row: Pick<TimingRow, "contact" | "lastActivity">): LastTouch | null {
  const c = row.contact;
  const candidates: { at: number; touch: LastTouch }[] = [];
  if (c?.lastOutboundAt) {
    const outIsAwaiting = c.awaitingReplySince && new Date(c.awaitingReplySince).getTime() >= new Date(c.lastOutboundAt).getTime();
    candidates.push({
      at: new Date(c.lastOutboundAt).getTime(),
      touch: outIsAwaiting ? { type: "awaiting", at: iso(c.awaitingReplySince!) } : { type: "email_out", at: iso(c.lastOutboundAt) },
    });
  }
  if (c?.lastInboundAt) candidates.push({ at: new Date(c.lastInboundAt).getTime(), touch: { type: "email_in", at: iso(c.lastInboundAt) } });
  const a = row.lastActivity;
  if (a && a.kind !== "status") {
    candidates.push({ at: new Date(a.occurredAt).getTime(), touch: { type: "activity", at: iso(a.occurredAt), kind: a.kind, outcome: a.outcome } });
  }
  candidates.sort((x, y) => y.at - x.at);
  return candidates[0]?.touch ?? null;
}

/**
 * Follow-up the log-call dialog suggests after a call: no answer / voicemail
 * → try again in 2 days; call back → tomorrow. Null for other outcomes.
 */
export function callFollowUpPreset(outcome: CallOutcome | null | undefined, today: string): { followUpAt: string; nextStep: string } | null {
  if (outcome === "no_answer" || outcome === "voicemail") return { followUpAt: addDays(today, 2), nextStep: "Call again" };
  if (outcome === "call_back") return { followUpAt: addDays(today, 1), nextStep: "Call back" };
  return null;
}
