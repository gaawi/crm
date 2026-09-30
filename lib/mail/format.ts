/**
 * Display helpers for the mail client (pure, client- and server-safe).
 * Every date function takes the app timezone and "now" explicitly so the
 * server render and the client hydration agree.
 */

export interface SenderLike {
  name: string | null;
  email: string | null;
  outbound: boolean;
  unread: boolean;
}

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function dayDiff(a: string, b: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

function time(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

function numericDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, year: "2-digit", month: "numeric", day: "numeric" }).format(date);
}

/**
 * Date column of a thread row.
 * gmail: "3:04 PM" today, "Sep 3" this year, "3/9/25" older.
 * ios:   "3:04 PM" today, "Yesterday", weekday within a week, "3/9/25" older.
 */
export function formatListDate(date: Date, timeZone: string, now: Date, style: "gmail" | "ios" = "gmail"): string {
  const day = dayKey(date, timeZone);
  const today = dayKey(now, timeZone);
  const diff = dayDiff(day, today);
  if (diff <= 0) return time(date, timeZone);
  if (style === "ios") {
    if (diff === 1) return "Yesterday";
    if (diff < 7) return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date);
    return numericDate(date, timeZone);
  }
  if (day.slice(0, 4) === today.slice(0, 4)) {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(date);
  }
  return numericDate(date, timeZone);
}

function relative(date: Date, now: Date): string | null {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return null;
}

/** Message header date, like Gmail: "Tue, Sep 29, 3:04 PM (1 day ago)"; the year when not this year. */
export function formatMessageDate(date: Date, timeZone: string, now: Date): string {
  const sameYear = dayKey(date, timeZone).slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const rel = relative(date, now);
  return rel ? `${text} (${rel})` : text;
}

/** Full date for the details popover: "Sep 29, 2026, 3:04 PM". */
export function formatFullDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** "Maya Chen" → "Maya"; addresses and single words stay whole. */
export function firstName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.includes("@")) return trimmed.split("@")[0];
  // "Chen, Maya" → "Maya"
  if (/^[^,]+,\s*\S/.test(trimmed)) return trimmed.split(",")[1].trim().split(/\s+/)[0];
  return trimmed.split(/\s+/)[0] || trimmed;
}

export function displayName(sender: { name: string | null; email: string | null }): string {
  return sender.name?.trim() || sender.email?.split("@")[0] || "(unknown)";
}

export interface SenderPart {
  text: string;
  unread: boolean;
}

/**
 * Gmail's sender column: "Maya Chen" for one sender, "Maya, me" for several
 * (first names), "Maya .. Tomás, me" when there are more than three.
 * `count` is the number of messages when above one ("(3)").
 */
export function formatSenders(senders: readonly SenderLike[], messageCount = senders.length): { parts: SenderPart[]; count: number | null } {
  const unique: { key: string; name: string; outbound: boolean; unread: boolean }[] = [];
  for (const s of senders) {
    const key = s.outbound ? "me" : (s.email ?? s.name ?? "").toLowerCase();
    const existing = unique.find((u) => u.key === key);
    if (existing) {
      existing.unread ||= s.unread;
      continue;
    }
    unique.push({ key, name: s.outbound ? "me" : displayName(s), outbound: s.outbound, unread: s.unread });
  }
  const count = messageCount > 1 ? messageCount : null;
  if (!unique.length) return { parts: [{ text: "(no sender)", unread: false }], count };
  if (unique.length === 1) return { parts: [{ text: unique[0].name, unread: unique[0].unread }], count };
  const short = unique.map((u) => ({ text: u.outbound ? "me" : firstName(u.name), unread: u.unread }));
  if (short.length <= 3) return { parts: short, count };
  return { parts: [short[0], { text: "..", unread: false }, ...short.slice(-2)], count };
}

/** Plain-text version of formatSenders (titles, tests). */
export function sendersText(senders: readonly SenderLike[], messageCount = senders.length): string {
  const { parts, count } = formatSenders(senders, messageCount);
  const names = parts.map((p, i) => (p.text === ".." ? " .. " : `${i > 0 && parts[i - 1].text !== ".." ? ", " : ""}${p.text}`)).join("");
  return count ? `${names} (${count})` : names;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Dot colors for accounts, by their position in the account list. */
const ACCOUNT_DOTS = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-rose-500", "bg-cyan-500"];

export function accountDot(index: number): string {
  return ACCOUNT_DOTS[((index % ACCOUNT_DOTS.length) + ACCOUNT_DOTS.length) % ACCOUNT_DOTS.length];
}
