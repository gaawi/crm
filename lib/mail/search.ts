/**
 * Gmail-style search operators, parsed into a structured filter that the
 * thread list translates to SQL over the synced messages (so search is
 * instant and unified across accounts).
 *
 * Supported: from: to: cc: subject: has:attachment is:unread is:read
 * is:starred is:important in:inbox|sent|trash|anywhere label: category:
 * after: before: (YYYY/MM/DD or YYYY-MM-DD) newer_than: older_than: (Nd/Nm/Ny)
 * "exact phrase" and plain words (full-text). A leading "-" negates from:,
 * to:, subject:, label: and is: terms.
 */

export type SearchIn = "inbox" | "sent" | "trash" | "anywhere" | "starred";
export type InboxCategory = "primary" | "promotions" | "social" | "updates" | "forums";

export interface MailFilter {
  /** Free text (words and quoted phrases), matched with full-text search. */
  text: string;
  from: string[];
  to: string[];
  subject: string[];
  notFrom: string[];
  notTo: string[];
  notSubject: string[];
  /** Gmail label ids or names (system names upper-cased: INBOX, STARRED…). */
  labels: string[];
  notLabels: string[];
  hasAttachment: boolean;
  in: SearchIn | null;
  category: InboxCategory | null;
  /** Inclusive lower bound, YYYY-MM-DD in the app timezone. */
  after: string | null;
  /** Exclusive upper bound, YYYY-MM-DD in the app timezone. */
  before: string | null;
  /** Relative bounds, e.g. "7 days". */
  newerThan: string | null;
  olderThan: string | null;
}

const IS_LABELS: Record<string, string> = {
  unread: "UNREAD",
  starred: "STARRED",
  important: "IMPORTANT",
};

const CATEGORIES = new Set<InboxCategory>(["primary", "promotions", "social", "updates", "forums"]);

export const CATEGORY_LABELS: Record<Exclude<InboxCategory, "primary">, string> = {
  promotions: "CATEGORY_PROMOTIONS",
  social: "CATEGORY_SOCIAL",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
};

function emptyFilter(): MailFilter {
  return {
    text: "",
    from: [],
    to: [],
    subject: [],
    notFrom: [],
    notTo: [],
    notSubject: [],
    labels: [],
    notLabels: [],
    hasAttachment: false,
    in: null,
    category: null,
    after: null,
    before: null,
    newerThan: null,
    olderThan: null,
  };
}

/** Split into tokens, keeping quoted values ("a b", from:"Ann Lee") together. */
export function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const re = /-?[a-z_]+:"[^"]*"?|"[^"]*"?|\S+/gi;
  for (const match of query.matchAll(re)) tokens.push(match[0]);
  return tokens;
}

function unquote(value: string): string {
  return value.replace(/^"|"$/g, "").trim();
}

function parseDate(value: string): string | null {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseRelative(value: string): string | null {
  const m = /^(\d{1,4})([dmy])$/i.exec(value);
  if (!m) return null;
  const unit = { d: "days", m: "months", y: "years" }[m[2].toLowerCase() as "d" | "m" | "y"];
  return `${Number(m[1])} ${unit}`;
}

/** True when the query uses at least one operator (not just words). */
export function hasOperators(query: string): boolean {
  return tokenize(query).some((t) => /^-?[a-z_]+:./i.test(t));
}

export function parseMailQuery(query: string): MailFilter {
  const filter = emptyFilter();
  const words: string[] = [];

  for (const token of tokenize(query.trim())) {
    const m = /^(-?)([a-z_]+):(.+)$/i.exec(token);
    if (!m) {
      words.push(token);
      continue;
    }
    const negated = m[1] === "-";
    const op = m[2].toLowerCase();
    const value = unquote(m[3]);
    if (!value) continue;
    const lower = value.toLowerCase();

    switch (op) {
      case "from":
        (negated ? filter.notFrom : filter.from).push(lower);
        break;
      case "to":
      case "cc":
      case "bcc":
        (negated ? filter.notTo : filter.to).push(lower);
        break;
      case "subject":
        (negated ? filter.notSubject : filter.subject).push(value);
        break;
      case "has":
        if (lower === "attachment" || lower === "attachments") filter.hasAttachment = true;
        else words.push(token);
        break;
      case "is":
        if (lower === "read") (negated ? filter.labels : filter.notLabels).push("UNREAD");
        else if (IS_LABELS[lower]) (negated ? filter.notLabels : filter.labels).push(IS_LABELS[lower]);
        else words.push(token);
        break;
      case "in":
        if (lower === "inbox" || lower === "sent" || lower === "trash" || lower === "anywhere" || lower === "starred") {
          filter.in = lower;
        } else {
          words.push(token);
        }
        break;
      case "label":
        (negated ? filter.notLabels : filter.labels).push(value);
        break;
      case "category":
        if (CATEGORIES.has(lower as InboxCategory)) filter.category = lower as InboxCategory;
        else words.push(token);
        break;
      case "after":
      case "since":
        filter.after = parseDate(value) ?? filter.after;
        break;
      case "before":
        filter.before = parseDate(value) ?? filter.before;
        break;
      case "newer_than":
        filter.newerThan = parseRelative(value) ?? filter.newerThan;
        break;
      case "older_than":
        filter.olderThan = parseRelative(value) ?? filter.olderThan;
        break;
      default:
        words.push(token);
    }
  }

  filter.text = words
    .map((w) => w.replace(/^-/, ""))
    .map(unquote)
    .filter(Boolean)
    .join(" ");
  return filter;
}
