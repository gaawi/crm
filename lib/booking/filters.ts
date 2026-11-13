/**
 * Sheet filters and sections (client and server): what the search box,
 * the status / goal / section selects and the toggles match, and how they
 * read in the URL (?q=&status=&goal=&section=&flag=due,no_reply).
 */
import { GOAL_KINDS, OPPORTUNITY_STAGES } from "@/lib/constants";
import { phoneDigits } from "@/lib/booking/phone";
import { isFollowUpDue, isNoReply, type TimingRow } from "@/lib/booking/timing";
import type { OpportunityKind, OpportunityStage } from "@/lib/types";

export const SHEET_FLAGS = ["due", "no_reply", "returning", "phone", "hot", "vip", "near_nyc", "chamber", "josefina", "claude", "chatgpt", "unresearched"] as const;
/**
 * due = follow-up due; no_reply = waiting > 10 days; hot = In conversation;
 * claude / chatgpt = the organization's profile was researched by that
 * assistant (profile.researchedBy); unresearched = no profile research yet;
 * vip / near_nyc / chamber / josefina = organization tags prestigious (the
 * places we really want to play; the flag keeps its old URL name), nyc-under-5h,
 * chamber-specialist, josefina-2025 (on Josefina's 2025 booking sheet).
 */
export type SheetFlag = (typeof SHEET_FLAGS)[number];

export const SHEET_FLAG_LABELS: Record<SheetFlag, string> = {
  due: "Follow-up due",
  no_reply: "No reply",
  returning: "Returning",
  phone: "Has phone",
  hot: "Hot",
  vip: "Prestigious",
  near_nyc: "< 5 h from NYC",
  chamber: "Chamber specialists",
  josefina: "Josefina 2025",
  claude: "Researched by Claude",
  chatgpt: "Researched by ChatGPT",
  unresearched: "Not researched",
};

export type Researcher = "claude" | "chatgpt";

/** Who researched the organization, from profile.researchedBy ("claude", "Claude public research…", "ChatGPT…"). */
export function researcherOf(profile: { researchedBy?: string | null } | null | undefined): Researcher | null {
  const by = (profile?.researchedBy ?? "").toLowerCase();
  if (by.includes("chatgpt")) return "chatgpt";
  if (by.includes("claude")) return "claude";
  return null;
}

/** Where a row came from (opportunities.origin), in the order the Origin select lists them. */
export const ORIGINS = [
  { value: "josefina-2025", label: "Josefina 2025" },
  { value: "hubspot", label: "HubSpot" },
  { value: "musical-america", label: "Musical America" },
  { value: "email", label: "Our email" },
  { value: "lists-2016-2019", label: "Lists 2016-2019" },
  { value: "research", label: "Research" },
  { value: "other", label: "Other" },
] as const;

export function originLabel(origin: string | null | undefined): string | null {
  if (!origin) return null;
  return ORIGINS.find((o) => o.value === origin)?.label ?? origin;
}

/**
 * Sections that always list in this order (booking campaigns by type);
 * other sections follow in the order they were first used.
 */
export const SECTION_ORDER = [
  "Chamber · series & societies",
  "Chamber · festivals",
  "General presenters",
  "Large productions",
  "Out of profile",
  "To classify",
];

/** Section value that selects the rows without a section. */
export const NO_SECTION = "__none";

export interface SheetFilters {
  q: string;
  /** "" = all */
  status: OpportunityStage | "";
  /** The rows' goal; absent / "" = all (?goal=venue). */
  kind?: OpportunityKind | "";
  /** "" = all, NO_SECTION = rows without one */
  section: string;
  /** All must match. */
  flags: SheetFlag[];
  /** Booking fit of the organization: "" = all; high_medium hides low and unknown. */
  fit?: FitFilter;
  /** Where the row came from (opportunities.origin); absent / "" = all. */
  origin?: string;
}

export const FIT_FILTERS = [
  { value: "high", label: "High fit" },
  { value: "high_medium", label: "High + medium fit" },
  { value: "medium", label: "Medium fit" },
  { value: "low", label: "Low fit" },
  { value: "unknown", label: "Fit not assessed" },
] as const;
export type FitFilter = (typeof FIT_FILTERS)[number]["value"] | "";

/** The organization's booking fit (high / medium / low), or null when not assessed. */
export function rowFit(row: { organization: FilterRow["organization"] }): "high" | "medium" | "low" | null {
  const fit = row.organization?.profile?.booking?.fit;
  return fit === "high" || fit === "medium" || fit === "low" ? fit : null;
}

function matchesFit(row: FilterRow, fit: FitFilter | undefined): boolean {
  if (!fit) return true;
  const f = rowFit(row);
  if (fit === "high_medium") return f === "high" || f === "medium";
  if (fit === "unknown") return f === null;
  return f === fit;
}

export const EMPTY_FILTERS: SheetFilters = { q: "", status: "", section: "", flags: [] };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: Params, key: string): string {
  if (params instanceof URLSearchParams) return params.get(key) ?? "";
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function sheetFiltersFromParams(params: Params): SheetFilters {
  const status = read(params, "status");
  const kind = read(params, "goal");
  const flags = read(params, "flag")
    .split(",")
    .filter((f): f is SheetFlag => (SHEET_FLAGS as readonly string[]).includes(f));
  return {
    q: read(params, "q").slice(0, 200),
    status: OPPORTUNITY_STAGES.some((s) => s.value === status) ? (status as OpportunityStage) : "",
    ...(GOAL_KINDS.some((k) => k.value === kind) ? { kind: kind as OpportunityKind } : {}),
    section: read(params, "section").slice(0, 120),
    flags: [...new Set(flags)],
    ...(FIT_FILTERS.some((f) => f.value === read(params, "fit")) ? { fit: read(params, "fit") as FitFilter } : {}),
    ...(read(params, "origin") ? { origin: read(params, "origin").slice(0, 40) } : {}),
  };
}

/** "?q=…&status=…" (empty string when nothing is filtered). */
export function sheetFiltersToQuery(filters: SheetFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.kind) params.set("goal", filters.kind);
  if (filters.section) params.set("section", filters.section);
  if (filters.flags.length) params.set("flag", filters.flags.join(","));
  if (filters.fit) params.set("fit", filters.fit);
  if (filters.origin) params.set("origin", filters.origin);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Lower case without accents: "Asturías" matches "asturias". */
export function fold(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** The parts of a row the filters read (SheetRow satisfies it). */
export interface FilterRow extends TimingRow {
  title: string;
  /** The row's goal (rows without one count as booking). */
  kind?: OpportunityKind;
  notes: string | null;
  section: string | null;
  spaces: string | null;
  returning: boolean;
  /** Where the row came from (opportunities.origin). */
  origin?: string | null;
  organization: {
    name: string;
    city: string | null;
    tags?: string[];
    profile?: { researchedBy?: string | null; booking?: { fit?: string | null } | null } | null;
  } | null;
  contact:
    | (NonNullable<TimingRow["contact"]> & {
        displayName: string;
        role: string | null;
        email: string | null;
        phone: string | null;
        whatsapp: string | null;
      })
    | null;
}

/** Search: venue, city, spaces, contact, role, email, phone (digits), notes, section. */
export function rowMatchesSearch(row: FilterRow, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(
    [
      row.organization?.name ?? row.title,
      row.organization?.city,
      row.spaces,
      row.contact?.displayName,
      row.contact?.role,
      row.contact?.email,
      row.notes,
      row.section,
    ].join("\n"),
  );
  const phones = `${phoneDigits(row.contact?.phone)} ${phoneDigits(row.contact?.whatsapp)}`;
  return words.every((word) => {
    if (haystack.includes(word)) return true;
    const digits = phoneDigits(word);
    return digits.length >= 3 && digits.length === word.replace(/[+\-().]/g, "").length && phones.includes(digits);
  });
}

export function rowHasFlag(row: FilterRow, flag: SheetFlag, today: string, timezone: string): boolean {
  switch (flag) {
    case "due":
      return isFollowUpDue(row, today);
    case "no_reply":
      return isNoReply(row, today, timezone);
    case "returning":
      return row.returning;
    case "phone":
      return Boolean(row.contact?.phone || row.contact?.whatsapp);
    case "hot":
      return row.stage === "negotiation";
    case "claude":
    case "chatgpt":
      return researcherOf(row.organization?.profile) === flag;
    case "unresearched":
      return researcherOf(row.organization?.profile) === null;
    case "vip":
      return Boolean(row.organization?.tags?.includes("prestigious"));
    case "near_nyc":
      return Boolean(row.organization?.tags?.includes("nyc-under-5h"));
    case "chamber":
      return Boolean(row.organization?.tags?.includes("chamber-specialist"));
    case "josefina":
      return Boolean(row.organization?.tags?.includes("josefina-2025"));
  }
}

export function filterRows<T extends FilterRow>(rows: readonly T[], filters: SheetFilters, today: string, timezone: string): T[] {
  return rows.filter(
    (row) =>
      (!filters.status || row.stage === filters.status) &&
      (!filters.kind || (row.kind ?? "booking") === filters.kind) &&
      (!filters.section || (filters.section === NO_SECTION ? !row.section : row.section === filters.section)) &&
      filters.flags.every((flag) => rowHasFlag(row, flag, today, timezone)) &&
      matchesFit(row, filters.fit) &&
      (!filters.origin || row.origin === filters.origin) &&
      rowMatchesSearch(row, filters.q),
  );
}

/**
 * Rows grouped by section: SECTION_ORDER first, then the others in the order
 * they were first used (earliest createdAt), rows keeping their order. Rows without a section come
 * last (section null, shown as "Other"); a sheet without any section gives
 * one group with section null.
 */
export function groupBySection<T extends { section: string | null; createdAt: string }>(
  rows: readonly T[],
): { section: string | null; rows: T[] }[] {
  const first = new Map<string, string>();
  for (const row of rows) {
    if (!row.section) continue;
    const seen = first.get(row.section);
    if (!seen || row.createdAt < seen) first.set(row.section, row.createdAt);
  }
  const rank = (s: string) => {
    const i = SECTION_ORDER.indexOf(s);
    return i < 0 ? SECTION_ORDER.length : i;
  };
  const order = [...first.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
    .map(([s]) => s);
  const groups = order.map((section) => ({ section: section as string | null, rows: rows.filter((r) => r.section === section) }));
  const rest = rows.filter((r) => !r.section);
  if (rest.length || !groups.length) groups.push({ section: null, rows: [...rest] });
  return groups;
}

/** Distinct sections of the rows, in the order they were first used. */
export function sheetSections(rows: readonly { section: string | null; createdAt: string }[]): string[] {
  return groupBySection(rows)
    .map((g) => g.section)
    .filter((s): s is string => s !== null);
}
