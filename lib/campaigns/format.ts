/**
 * Plain-language wording for campaigns (client and server): the sending plan
 * ("87 emails from …, about 10 an hour, 9:00–19:00 Monday–Friday (Madrid).
 * First one around 10:05, last one around Tue 6 Oct."), send-time phrases and
 * the per-status counts shown on campaign cards. Times are shown in the
 * campaign's timezone, the one its sending hours are written in.
 */
import { zonedParts } from "@/lib/campaigns/schedule";
import type { CampaignCounts, CampaignSettings } from "@/lib/campaigns/types";
import { HELD_BACK_PREFIX } from "@/lib/campaigns/types";
import type { DraftStatus } from "@/lib/types";

/** The cron that sends campaign emails runs every 5 minutes. */
const TICK_MS = 5 * 60_000;

/** Up to the next cron tick (estimates are "around 10:05", not "10:03:12"). */
export function roundUpToTick(at: Date): Date {
  return new Date(Math.ceil(at.getTime() / TICK_MS) * TICK_MS);
}

/** "Europe/Madrid" → "Madrid", "America/New_York" → "New York". */
export function timeZoneCity(timeZone: string): string {
  return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
}

/** "9:00", "19:00" (24-hour clock, like the sending hours). */
export function hourLabel(hour: number): string {
  return `${hour}:00`;
}

export function hoursLabel(settings: Pick<CampaignSettings, "windowStart" | "windowEnd">): string {
  return `${hourLabel(settings.windowStart)}–${hourLabel(settings.windowEnd)}`;
}

// Built from numeric parts, not Intl's formatted strings: those differ between
// ICU versions ("Mon 5 Oct" on the server, "Mon, 5 Oct" in Chrome; "Sep" /
// "Sept"), which breaks hydration of the client components that show them.
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "10:05" in the timezone. */
export function formatClock(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.hour}:${String(p.minute).padStart(2, "0")}`;
}

/** "Tue 6 Oct" in the timezone. */
export function formatDay(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  const [, month, day] = p.date.split("-").map(Number);
  return `${WEEKDAY_NAMES[p.weekday]} ${day} ${MONTH_NAMES[month - 1]}`;
}

function dayOffset(at: Date, now: Date, timeZone: string): number {
  const a = zonedParts(at, timeZone).date;
  const b = zonedParts(now, timeZone).date;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** "around 10:05", "tomorrow around 9:00", "Mon 5 Oct around 9:00". */
export function whenPhrase(at: Date, timeZone: string, now: Date): string {
  const clock = formatClock(at, timeZone);
  const offset = dayOffset(at, now, timeZone);
  if (offset <= 0) return `around ${clock}`;
  if (offset === 1) return `tomorrow around ${clock}`;
  return `${formatDay(at, timeZone)} around ${clock}`;
}

/** "around 17:20" the same day as `from`, else "around Tue 6 Oct" ("tomorrow"). */
export function dayPhrase(at: Date, timeZone: string, now: Date, from: Date | null): string {
  if (from && zonedParts(from, timeZone).date === zonedParts(at, timeZone).date) return `around ${formatClock(at, timeZone)}`;
  const offset = dayOffset(at, now, timeZone);
  if (offset <= 0) return `around ${formatClock(at, timeZone)}`;
  if (offset === 1) return "tomorrow";
  return `around ${formatDay(at, timeZone)}`;
}

/** Whether the daily maximum, not the hourly pace, decides how many go out in a day. */
export function dailyCapBinds(settings: CampaignSettings): boolean {
  return settings.dailyCap < settings.perHour * (settings.windowEnd - settings.windowStart);
}

/** "about 10 an hour, at most 40 a day, 9:00–19:00 Monday–Friday (Madrid)". */
export function paceSentence(settings: CampaignSettings): string {
  const parts = [`about ${settings.perHour} an hour`];
  if (dailyCapBinds(settings)) parts.push(`at most ${settings.dailyCap} a day`);
  parts.push(`${hoursLabel(settings)} ${settings.weekdaysOnly ? "Monday–Friday" : "every day"} (${timeZoneCity(settings.timezone)})`);
  return parts.join(", ");
}

/**
 * The plan in one or two sentences: "87 emails from guillermo@…, about 10 an
 * hour, 9:00–19:00 Monday–Friday (Madrid). First one around 10:05, last one
 * around Tue 6 Oct." `next` / `finish` come from estimateSends.
 */
export function planSentence(input: {
  count: number;
  accountEmail: string;
  settings: CampaignSettings;
  next: Date | null;
  finish: Date | null;
  now: Date;
  /** The owner's own timezone: when it differs, the times say "(Madrid time)". */
  ownerTimezone?: string;
  /** "First one" (a new campaign) or "Next one" (already sending). */
  started?: boolean;
}): string {
  const { count, settings, now } = input;
  if (count <= 0) return "Nothing left to send.";
  const head = `${count} ${count === 1 ? "email" : "emails"} from ${input.accountEmail}, ${paceSentence(settings)}.`;
  if (!input.next) return head;
  const tz = settings.timezone;
  const next = roundUpToTick(input.next);
  const label = input.started ? "Next one" : "First one";
  const zone = input.ownerTimezone && input.ownerTimezone !== tz ? ` (${timeZoneCity(tz)} time)` : "";
  if (count === 1 || !input.finish) return `${head} ${count === 1 ? "It goes out" : label} ${whenPhrase(next, tz, now)}${zone}.`;
  const finish = roundUpToTick(input.finish);
  return `${head} ${label} ${whenPhrase(next, tz, now)}, last one ${dayPhrase(finish, tz, now, next)}${zone}.`;
}

/** A campaign email that the sender held back because the contact got in touch first. */
export function isHeldBack(draft: { status: DraftStatus; error: string | null }): boolean {
  return draft.status === "proposed" && Boolean(draft.error?.startsWith(HELD_BACK_PREFIX));
}

export type CountTone = "default" | "info" | "success" | "warning" | "danger" | "subtle";

export interface CountPart {
  key: "toApprove" | "queued" | "sending" | "sent" | "held" | "failed" | "discarded";
  label: string;
  count: number;
  tone: CountTone;
}

/** The campaign's emails by what they are waiting for, without the empty ones. */
export function countParts(counts: CampaignCounts, held: number, options: { discarded?: boolean } = {}): CountPart[] {
  const toApprove = Math.max(0, counts.proposed - held) + counts.revising;
  const parts: CountPart[] = [
    { key: "toApprove", label: "to approve", count: toApprove, tone: "default" },
    { key: "queued", label: "queued", count: counts.queued, tone: "info" },
    { key: "sending", label: "sending", count: counts.sending, tone: "info" },
    { key: "sent", label: "sent", count: counts.sent, tone: "success" },
    { key: "held", label: "held back", count: held, tone: "warning" },
    { key: "failed", label: "failed", count: counts.failed, tone: "danger" },
  ];
  if (options.discarded) parts.push({ key: "discarded", label: "discarded", count: counts.discarded, tone: "subtle" });
  return parts.filter((p) => p.count > 0);
}

/** Emails that are (or will be) sent: everything but the discarded ones. */
export function campaignSize(counts: CampaignCounts): number {
  return counts.total - counts.discarded;
}
