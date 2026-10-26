/**
 * Campaign sending rules as pure functions (client and server): settings
 * validation, the sending window in the campaign's timezone, the gap between
 * sends and send-time estimates. The scheduler (lib/campaigns/scheduler.ts)
 * and the approval dialog's preview use the same code.
 */
import { addDays, toISODate, zonedDateTimeToUtc } from "@/lib/dates";
import { CAMPAIGN_LIMITS, DEFAULT_CAMPAIGN_SETTINGS, type CampaignSettings } from "@/lib/campaigns/types";

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Complete and check settings: missing fields come from `base` (default
 * DEFAULT_CAMPAIGN_SETTINGS). Returns the settings or the first problem, as a
 * sentence for the owner.
 */
export function validateCampaignSettings(
  input: Partial<CampaignSettings>,
  base: CampaignSettings = DEFAULT_CAMPAIGN_SETTINGS,
): { ok: true; settings: CampaignSettings } | { ok: false; error: string } {
  const settings: CampaignSettings = { ...base, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  const int = (value: unknown) => typeof value === "number" && Number.isInteger(value);
  const { perHour, dailyCap, windowStart, windowEnd } = CAMPAIGN_LIMITS;
  if (!int(settings.perHour) || settings.perHour < perHour.min || settings.perHour > perHour.max) {
    return { ok: false, error: `Send between ${perHour.min} and ${perHour.max} emails per hour.` };
  }
  if (!int(settings.dailyCap) || settings.dailyCap < dailyCap.min || settings.dailyCap > dailyCap.max) {
    return { ok: false, error: `Send between ${dailyCap.min} and ${dailyCap.max} emails per day.` };
  }
  if (!int(settings.windowStart) || settings.windowStart < windowStart.min || settings.windowStart > windowStart.max) {
    return { ok: false, error: "The sending hours must start between 0:00 and 23:00." };
  }
  if (!int(settings.windowEnd) || settings.windowEnd < windowEnd.min || settings.windowEnd > windowEnd.max) {
    return { ok: false, error: "The sending hours must end between 1:00 and 24:00." };
  }
  if (settings.windowEnd <= settings.windowStart) return { ok: false, error: "The sending hours must end after they start." };
  if (typeof settings.weekdaysOnly !== "boolean") return { ok: false, error: "Choose whether to send on weekends." };
  if (typeof settings.timezone !== "string" || !isValidTimeZone(settings.timezone)) {
    return { ok: false, error: "Pick a valid time zone (e.g. Europe/Madrid)." };
  }
  return { ok: true, settings };
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of an instant in a timezone. weekday: 0 = Sunday … 6 = Saturday. */
export function zonedParts(at: Date, timeZone: string): { date: string; hour: number; minute: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: toISODate(at, timeZone), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: WEEKDAYS[parts.weekday] ?? 0 };
}

type Window = Pick<CampaignSettings, "windowStart" | "windowEnd" | "weekdaysOnly" | "timezone">;

const isWeekend = (weekday: number) => weekday === 0 || weekday === 6;

/** Inside the sending hours (and on a weekday when weekdaysOnly). */
export function inSendingWindow(settings: Window, at: Date): boolean {
  const p = zonedParts(at, settings.timezone);
  if (settings.weekdaysOnly && isWeekend(p.weekday)) return false;
  return p.hour >= settings.windowStart && p.hour < settings.windowEnd;
}

/** The instant `hour`:00 on the calendar day `date` in the timezone (hour 24 = the next midnight). */
function atHour(date: string, hour: number, timeZone: string): Date {
  const day = hour >= 24 ? addDays(date, 1) : date;
  const h = hour >= 24 ? 0 : hour;
  return zonedDateTimeToUtc(`${day}T${String(h).padStart(2, "0")}:00`, timeZone)!;
}

/** Start of the calendar day `date` ('YYYY-MM-DD') in the timezone, as an instant. */
export function startOfZonedDay(date: string, timeZone: string): Date {
  return atHour(date, 0, timeZone);
}

/** The earliest instant at or after `at` inside the sending window. */
export function nextWindowOpening(settings: Window, at: Date): Date {
  if (inSendingWindow(settings, at)) return at;
  const p = zonedParts(at, settings.timezone);
  let date = p.date;
  for (let i = 0; i < 9; i++) {
    const weekday = (p.weekday + i) % 7;
    const allowed = !settings.weekdaysOnly || !isWeekend(weekday);
    if (allowed) {
      const opens = atHour(date, settings.windowStart, settings.timezone);
      if (opens.getTime() >= at.getTime()) return opens;
    }
    date = addDays(date, 1);
  }
  return at; // unreachable with valid settings
}

/** Minimum time between two sends at `perHour` (ms). */
export function minGapMs(perHour: number): number {
  return Math.round(3_600_000 / Math.max(1, perHour));
}

/** FNV-1a of a string → [0, 1). */
function unitHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}

/**
 * The gap before the next send: minGapMs(perHour) ±40%, the same for a given
 * seed (campaign id + last send), so every run agrees on the next send time.
 * Wide on purpose: a person sending emails one by one is never regular.
 */
export function jitteredGapMs(perHour: number, seed: string): number {
  return Math.round(minGapMs(perHour) * (0.6 + 0.8 * unitHash(seed)));
}

/** At least this long between two sends from one account, whatever the campaigns (2 to 4 minutes, varied per send). */
export function accountGapMs(seed: string): number {
  return Math.round(120_000 * (1 + unitHash(seed)));
}

/**
 * Estimated send times for `count` emails from `now` at these settings: the
 * gap (without jitter), the window and the daily cap (`sentToday` already sent
 * today). Ignores the cron's 5-minute ticks, holds and failures.
 */
export function estimateSends(
  settings: CampaignSettings,
  options: { count: number; now: Date; lastSentAt?: Date | null; sentToday?: number },
): { next: Date | null; finish: Date | null } {
  const count = Math.max(0, Math.floor(options.count));
  if (!count) return { next: null, finish: null };
  const gap = minGapMs(settings.perHour);
  const today = zonedParts(options.now, settings.timezone).date;
  let t = new Date(Math.max(options.now.getTime(), options.lastSentAt ? options.lastSentAt.getTime() + gap : 0));
  let dayKey = "";
  let daySent = 0;
  let next: Date | null = null;
  let last: Date | null = null;
  for (let sent = 0, guard = 0; sent < count && guard < count * 4 + 1000; guard++) {
    t = nextWindowOpening(settings, t);
    const key = zonedParts(t, settings.timezone).date;
    if (key !== dayKey) {
      dayKey = key;
      daySent = key === today ? (options.sentToday ?? 0) : 0;
    }
    if (daySent >= settings.dailyCap) {
      t = startOfZonedDay(addDays(key, 1), settings.timezone);
      continue;
    }
    next ??= t;
    last = t;
    sent++;
    daySent++;
    t = new Date(t.getTime() + gap);
  }
  return { next, finish: last };
}
