"use client";

import {
  Bot,
  Building2,
  Car,
  Check,
  ListChecks,
  Music,
  Pencil,
  RotateCcw,
  Rows3,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";
import {
  EMPTY_FILTERS,
  FIT_FILTERS,
  NO_SECTION,
  ORIGINS,
  SHEET_FLAG_LABELS,
  type FitFilter,
  type SheetFilters,
  type SheetFlag,
} from "@/lib/booking/filters";
import type { OpportunityKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/booking/info-tip";
import { AUTO_LOCK_NOTE, explainFlag } from "@/lib/booking/explain";
import { SearchInput } from "../../_components/ui";
import { scrollerClass, StatsStrip, type StatItem } from "./stats";

/**
 * The colored tags under the search bar, in the same colors as on the rows;
 * each one filters and shows how many rows it would leave.
 */
const TAGS: { flag: SheetFlag; icon: LucideIcon; off: string; on: string }[] = [
  {
    flag: "vip",
    icon: Star,
    off: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
    on: "border-amber-500 bg-amber-400 text-amber-950",
  },
  {
    flag: "nyc",
    icon: Building2,
    off: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300",
    on: "border-rose-600 bg-rose-600 text-white",
  },
  {
    flag: "near_nyc",
    icon: Car,
    off: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300",
    on: "border-sky-600 bg-sky-600 text-white",
  },
  {
    flag: "chamber",
    icon: Music,
    off: "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-300",
    on: "border-indigo-600 bg-indigo-600 text-white",
  },
  {
    flag: "returning",
    icon: RotateCcw,
    off: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300",
    on: "border-violet-600 bg-violet-600 text-white",
  },
  {
    flag: "claude",
    icon: Sparkles,
    off: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-300",
    on: "border-orange-500 bg-orange-500 text-white",
  },
  {
    flag: "chatgpt",
    icon: Sparkles,
    off: "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-300",
    on: "border-teal-600 bg-teal-600 text-white",
  },
];

const pillSelect =
  "h-9 shrink-0 cursor-pointer appearance-auto rounded-full border border-border bg-surface pl-3 pr-2 text-[15px] text-fg focus:border-border-strong focus:outline-none md:h-8 md:rounded-md md:pl-2.5 md:text-sm";

/**
 * The filters split by who sets them, so anyone opening the sheet sees what
 * updates by itself and what a person changes.
 */
const GROUPS: {
  key: "auto" | "manual";
  title: string;
  hint: string;
  icon: LucideIcon;
  stats: string[];
  flags: SheetFlag[];
}[] = [
  {
    key: "auto",
    title: "Automatic",
    hint: "Updated by themselves from the emails and the research. Nobody can change them by hand.",
    icon: Bot,
    stats: ["total", "contacted", "replied", "no_reply"],
    flags: [
      "bounced",
      "auto_reply",
      "nyc",
      "near_nyc",
      "chamber",
      "claude",
      "chatgpt",
      "phone",
      "unresearched",
    ],
  },
  {
    key: "manual",
    title: "Set by you",
    hint: "You change these on each row (status, follow-up date, Returning) or on the organization (Prestigious).",
    icon: Pencil,
    stats: ["proposal", "won", "lost", "due"],
    flags: ["vip", "returning"],
  },
];

const chip =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[15px] transition-colors md:h-8 md:rounded-md md:px-2.5 md:text-sm";

export function FiltersBar({
  filters,
  onChange,
  goalOptions,
  sections,
  sectionCounts,
  flagCounts,
  stats,
  hasUnsectioned,
  shown,
  total,
  compact,
  onCompact,
  selectMode,
  onSelectMode,
}: {
  filters: SheetFilters;
  onChange: (next: SheetFilters) => void;
  /** The sheet's goals with their counts: a goal select when there are two or more. */
  goalOptions: { value: OpportunityKind; label: string; count: number }[];
  sections: string[];
  /** Rows per section over the whole sheet ("" = rows without a section). */
  sectionCounts?: ReadonlyMap<string, number>;
  /** Rows each tag would leave, given the other filters. */
  flagCounts?: ReadonlyMap<SheetFlag, number>;
  /** The counts (Total, Contacted, Replied, Offer sent… Follow-ups due, No reply): placed in their group. */
  stats: StatItem[];
  /** Some rows have no section (offers "No section"). */
  hasUnsectioned: boolean;
  shown: number;
  total: number;
  compact: boolean;
  onCompact: (compact: boolean) => void;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
}) {
  const filtered = Boolean(
    filters.q.trim() ||
    filters.status ||
    filters.kind ||
    filters.section ||
    filters.flags.length ||
    filters.fit ||
    filters.origin,
  );
  // Plain pills after the colored tags: the other filters, plus any other flag that is on (e.g. ?flag=hot from a link).
  const toggleFlag = (flag: SheetFlag) =>
    onChange({
      ...filters,
      flags: filters.flags.includes(flag)
        ? filters.flags.filter((f) => f !== flag)
        : [...filters.flags, flag],
    });

  const renderFlag = (flag: SheetFlag) => {
    const on = filters.flags.includes(flag);
    const tag = TAGS.find((t) => t.flag === flag);
    const n = flagCounts?.get(flag);
    const info = explainFlag(flag);
    const Icon = tag?.icon;
    return (
      <span key={flag} className="inline-flex shrink-0 items-center">
        <button
          type="button"
          aria-pressed={on}
          onClick={() => toggleFlag(flag)}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[13px] font-medium transition-colors md:h-7 md:text-xs",
            tag
              ? on
                ? tag.on
                : cn(tag.off, "hover:brightness-95")
              : on
                ? "border-accent bg-accent text-accent-fg"
                : "border-border bg-surface text-muted hover:text-fg active:bg-surface-2 md:hover:bg-surface-2",
          )}
        >
          {Icon ? (
            <Icon className="size-3.5 md:size-3" strokeWidth={2} aria-hidden />
          ) : on ? (
            <Check
              className="size-3.5 md:size-3"
              strokeWidth={2.25}
              aria-hidden
            />
          ) : null}
          {SHEET_FLAG_LABELS[flag]}
          {n !== undefined ? (
            <span className="tabular-nums opacity-70">{n}</span>
          ) : null}
        </button>
        {info ? (
          <InfoTip
            title={info.label}
            items={[info]}
            note={info.how === "auto" ? AUTO_LOCK_NOTE : undefined}
          />
        ) : null}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-2 pb-3 md:flex-row md:flex-wrap md:items-center md:gap-2 md:pb-0 md:pt-2">
      <SearchInput
        value={filters.q}
        onChange={(e) => onChange({ ...filters, q: e.currentTarget.value })}
        placeholder="Search organization, city, contact, phone…"
        aria-label="Search this campaign"
        className="md:w-64"
      />

      <div
        className={cn(
          scrollerClass,
          "-mx-4 gap-2 px-4 md:mx-0 md:contents md:px-0",
        )}
      >
        {goalOptions.length > 1 || filters.kind ? (
          <select
            value={filters.kind ?? ""}
            onChange={(e) =>
              onChange({
                ...filters,
                kind: e.currentTarget.value as OpportunityKind | "",
              })
            }
            aria-label="Goal"
            className={cn(
              pillSelect,
              "max-w-[14rem]",
              filters.kind && "border-fg/70 font-medium",
            )}
          >
            <option value="">All goals</option>
            {goalOptions.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label} ({g.count})
              </option>
            ))}
          </select>
        ) : null}

        {sections.length ? (
          <select
            value={filters.section}
            onChange={(e) =>
              onChange({ ...filters, section: e.currentTarget.value })
            }
            aria-label="Category"
            className={cn(
              pillSelect,
              "max-w-[14rem]",
              filters.section && "border-fg/70 font-medium",
            )}
          >
            <option value="">
              All categories
              {sectionCounts
                ? ` (${[...sectionCounts.values()].reduce((a, b) => a + b, 0)})`
                : ""}
            </option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
                {sectionCounts?.has(s) ? ` (${sectionCounts.get(s)})` : ""}
              </option>
            ))}
            {hasUnsectioned ? (
              <option value={NO_SECTION}>
                No section
                {sectionCounts?.has("") ? ` (${sectionCounts.get("")})` : ""}
              </option>
            ) : null}
          </select>
        ) : null}

        <select
          value={filters.fit ?? ""}
          onChange={(e) =>
            onChange({ ...filters, fit: e.currentTarget.value as FitFilter })
          }
          aria-label="Fit"
          title="Booking fit from the research"
          className={cn(pillSelect, filters.fit && "border-fg/70 font-medium")}
        >
          <option value="">Any fit</option>
          {FIT_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          value={filters.origin ?? ""}
          onChange={(e) =>
            onChange({ ...filters, origin: e.currentTarget.value })
          }
          aria-label="Origin"
          title="Where the contact came from"
          className={cn(
            pillSelect,
            filters.origin && "border-fg/70 font-medium",
          )}
        >
          <option value="">Any origin</option>
          {ORIGINS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Two clearly separate groups: what updates by itself, and what a person sets. */}
      <div className="flex w-full flex-col gap-2">
        {GROUPS.map((g) => {
          const groupStats = stats.filter((st) => g.stats.includes(st.key));
          return (
            <section
              key={g.key}
              aria-label={g.title}
              className={cn(
                "rounded-xl border px-3 py-2 md:rounded-lg",
                g.key === "auto"
                  ? "border-sky-200 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/20"
                  : "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20",
              )}
            >
              <p className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-fg">
                  <g.icon className="size-3.5" strokeWidth={2} aria-hidden />
                  {g.title}
                </span>
                <span className="text-muted">{g.hint}</span>
              </p>
              <div className={cn(scrollerClass, "gap-1.5 md:flex-wrap")}>
                {groupStats.length ? (
                  <StatsStrip items={groupStats} bare />
                ) : null}
                {g.flags.map((flag) => renderFlag(flag))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex min-h-9 items-center gap-3 md:ml-auto md:min-h-0">
        <p
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] text-muted md:flex-none md:text-xs",
            !filtered && "md:hidden",
          )}
          aria-live="polite"
        >
          {filtered
            ? `${shown} of ${total}`
            : `${total} ${total === 1 ? "contact" : "contacts"}`}
          {filtered ? (
            <>
              {" · "}
              <button
                type="button"
                onClick={() => onChange(EMPTY_FILTERS)}
                className="font-medium text-fg/80 underline-offset-2 active:opacity-60 md:hover:underline"
              >
                {/* Phones: room for Compact / Select on the same line. */}
                <span className="md:hidden">Clear</span>
                <span className="hidden md:inline">Clear filters</span>
              </button>
            </>
          ) : null}
        </p>
        {/* Phones: compact cards and select mode (the desktop table always has checkboxes). */}
        <button
          type="button"
          aria-pressed={compact}
          onClick={() => onCompact(!compact)}
          className={cn(
            chip,
            "h-9 md:hidden",
            compact
              ? "border-fg/70 font-medium text-fg"
              : "border-border bg-surface text-muted",
          )}
        >
          <Rows3 className="size-4" strokeWidth={1.75} aria-hidden />
          Compact
        </button>
        <button
          type="button"
          aria-pressed={selectMode}
          onClick={() => onSelectMode(!selectMode)}
          className={cn(
            chip,
            "h-9 md:hidden",
            selectMode
              ? "border-accent bg-accent font-medium text-accent-fg"
              : "border-border bg-surface text-muted",
          )}
        >
          <ListChecks className="size-4" strokeWidth={1.75} aria-hidden />
          {selectMode ? "Done" : "Select"}
        </button>
      </div>
    </div>
  );
}
