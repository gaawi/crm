/**
 * Email campaigns as the client receives them (no "server-only": safe to
 * import from client components). A campaign groups emails prepared together
 * (more than one "Prepare email" from a booking sheet). Nothing is sent until
 * the owner approves it ("Approve N and start sending"); then the cron sends
 * the queued emails a few at a time inside the sending window.
 * Timestamps are ISO strings.
 */
import type { CampaignStatus, DraftStatus } from "@/lib/types";

export type { CampaignStatus };

/** Most emails sent from one Gmail account by all campaigns together in any 24 hours. */
export const ACCOUNT_DAILY_SEND_CAP = 150;

/**
 * Start of the error of an email the sender held back (back to "proposed")
 * because the contact got in touch after it was prepared — the wording of
 * holdReason in lib/campaigns/scheduler.ts.
 */
export const HELD_BACK_PREFIX = "Held back:";

/** How the owner wants a campaign sent (startCampaign / updateCampaignSettings). */
export interface CampaignSettings {
  /** 1–60 emails per hour: at least 3600 / perHour seconds apart (±20%). */
  perHour: number;
  /** 1–400 emails per day (in the campaign's timezone). */
  dailyCap: number;
  /** Sending hours [windowStart, windowEnd) in `timezone`: 0–23 and 1–24, end after start. */
  windowStart: number;
  windowEnd: number;
  /** Monday to Friday only. */
  weekdaysOnly: boolean;
  /** IANA name, e.g. "Europe/Madrid" (the recipients' time). */
  timezone: string;
}

export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettings = {
  perHour: 10,
  dailyCap: 40,
  windowStart: 9,
  windowEnd: 19,
  weekdaysOnly: true,
  timezone: "Europe/Madrid",
};

export const CAMPAIGN_LIMITS = {
  perHour: { min: 1, max: 60 },
  dailyCap: { min: 1, max: 400 },
  windowStart: { min: 0, max: 23 },
  windowEnd: { min: 1, max: 24 },
} as const;

export const CAMPAIGN_STATUSES: { value: CampaignStatus; label: string; hint: string }[] = [
  { value: "draft", label: "Waiting for approval", hint: "Prepared; nothing is sent until you approve it" },
  { value: "running", label: "Sending", hint: "Approved; sent a few at a time inside the sending hours" },
  { value: "paused", label: "Paused", hint: "Nothing is sent until you resume it" },
  { value: "done", label: "Done", hint: "Every approved email was sent (or held back for you)" },
  { value: "cancelled", label: "Cancelled", hint: "Stopped; unsent emails went back to waiting for approval" },
];

/** Emails of the campaign per status. */
export type CampaignCounts = Record<DraftStatus, number> & { total: number };

export interface Campaign extends CampaignSettings {
  id: string;
  name: string;
  /** The booking sheet it was prepared from. */
  projectId: string | null;
  projectName: string | null;
  /** The Gmail account it sends from. */
  accountId: string;
  accountEmail: string;
  /** "active" | "reauth_required" | "disconnected" */
  accountStatus: string;
  status: CampaignStatus;
  lastSentAt: string | null;
  consecutiveFailures: number;
  /** Why it paused (failures, account to reconnect…), shown to the owner. */
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: CampaignCounts;
  /** Of counts.proposed: emails the sender held back (the contact got in touch); each needs the owner's check. */
  heldBack: number;
}

export interface CampaignSummary extends Campaign {
  /** Sent today (campaign timezone). */
  sentToday: number;
  /** Sent by any campaign from the same account in the last 24 hours. */
  accountSentLast24h: number;
  /**
   * Emails still to send: queued (running / paused), or proposed + failed
   * but not held back while waiting for approval (what "Approve N" would queue).
   */
  remaining: number;
  /** Estimated next send (running only; null when nothing is left or it is paused). */
  nextSendAt: string | null;
  /** Estimated last send for `remaining` emails at the current settings (ignores holds and failures). */
  finishEstimate: string | null;
}
