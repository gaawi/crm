/**
 * Date helpers usable on server and client. Calendar dates are 'YYYY-MM-DD'.
 * Server code passes env.timezone; client code passes the timezone it was given.
 */

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return toISODate(now, timeZone);
}

export function toISODate(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a), for 'YYYY-MM-DD' strings. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** "Mar 4" this year, "Mar 4, 2024" otherwise. */
export function formatDate(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "";
  const date = typeof value === "string" ? isoDateToUtc(value) : value;
  const tz = typeof value === "string" ? "UTC" : timeZone;
  const sameYear = toISODate(date, tz).slice(0, 4) === toISODate(new Date(), timeZone).slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

export function formatDateTime(value: Date | null | undefined, timeZone: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

/** "just now", "5m ago", "3h ago", "yesterday", "4d ago", then a date. */
export function formatRelative(value: Date | null | undefined, timeZone: string, now: Date = new Date()): string {
  if (!value) return "never";
  const seconds = Math.round((now.getTime() - value.getTime()) / 1000);
  if (seconds < 0) return formatDate(value, timeZone);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = daysBetween(toISODate(value, timeZone), toISODate(now, timeZone));
  if (days <= 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return formatDate(value, timeZone);
}

/** Label for a follow-up date relative to today: "Overdue 3d", "Today", "Tomorrow", "in 5d", "Mar 4". */
export function formatDue(isoDate: string, today: string): string {
  const diff = daysBetween(today, isoDate);
  if (diff < 0) return `Overdue ${-diff}d`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 14) return `in ${diff}d`;
  return formatDate(isoDate, "UTC");
}

function isoDateToUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
