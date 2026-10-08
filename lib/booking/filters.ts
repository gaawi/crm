/**
 * Sheet filters and sections (client and server): what the search box,
 * the status / goal / section selects and the toggles match, and how they
 * read in the URL (?q=&status=&goal=&section=&flag=due,no_reply).
 */
import { GOAL_KINDS, OPPORTUNITY_STAGES } from "@/lib/constants";
import { phoneDigits } from "@/lib/booking/phone";
import { isFollowUpDue, isNoReply, type TimingRow } from "@/lib/booking/timing";
import type { OpportunityKind, OpportunityStage } from "@/lib/types";

export const SHEET_FLAGS = ["due", "no_reply", "returning", "phone", "hot"] as const;
/** due = follow-up due; no_reply = waiting > 10 days; hot = In conversation. */
export type SheetFlag = (typeof SHEET_FLAGS)[number];

export const SHEET_FLAG_LABELS: Record<SheetFlag, string> = {
  due: "Follow-up due",
  no_reply: "No reply",
  returning: "Returning",
  phone: "Has phone",
  hot: "Hot",
};

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
  organization: { name: string; city: string | null } | null;
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
  }
}

export function filterRows<T extends FilterRow>(rows: readonly T[], filters: SheetFilters, today: string, timezone: string): T[] {
  return rows.filter(
    (row) =>
      (!filters.status || row.stage === filters.status) &&
      (!filters.kind || (row.kind ?? "booking") === filters.kind) &&
      (!filters.section || (filters.section === NO_SECTION ? !row.section : row.section === filters.section)) &&
      filters.flags.every((flag) => rowHasFlag(row, flag, today, timezone)) &&
      rowMatchesSearch(row, filters.q),
  );
}

/**
 * Rows grouped by section, sections in the order they were first used
 * (earliest createdAt), rows keeping their order. Rows without a section come
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
  const order = [...first.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([s]) => s);
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
