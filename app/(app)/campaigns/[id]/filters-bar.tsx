"use client";

import { Check, ListChecks, Rows3 } from "lucide-react";
import { EMPTY_FILTERS, FIT_FILTERS, NO_SECTION, ORIGINS, SHEET_FLAG_LABELS, type FitFilter, type SheetFilters, type SheetFlag } from "@/lib/booking/filters";
import type { OpportunityKind, OpportunityStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SearchInput } from "../../_components/ui";
import { scrollerClass } from "./stats";

/** The two toggles always shown as chips; the rest sit in "More filters" (and show as chips while on). */
const TOGGLES: SheetFlag[] = ["vip", "near_nyc"];
const MORE: SheetFlag[] = ["phone", "returning", "due", "no_reply", "claude", "chatgpt", "unresearched", "chamber", "josefina"];

const pillSelect =
  "h-9 shrink-0 cursor-pointer appearance-auto rounded-full border border-border bg-surface pl-3 pr-2 text-[15px] text-fg focus:border-border-strong focus:outline-none md:h-8 md:rounded-md md:pl-2.5 md:text-sm";

const chip =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[15px] transition-colors md:h-8 md:rounded-md md:px-2.5 md:text-sm";

export function FiltersBar({
  filters,
  onChange,
  statusOptions,
  goalOptions,
  sections,
  sectionCounts,
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
  statusOptions: { value: OpportunityStage; label: string; count: number }[];
  /** The sheet's goals with their counts: a goal select when there are two or more. */
  goalOptions: { value: OpportunityKind; label: string; count: number }[];
  sections: string[];
  /** Rows per section over the whole sheet ("" = rows without a section). */
  sectionCounts?: ReadonlyMap<string, number>;
  /** Some rows have no section (offers "No section"). */
  hasUnsectioned: boolean;
  shown: number;
  total: number;
  compact: boolean;
  onCompact: (compact: boolean) => void;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
}) {
  const filtered = Boolean(filters.q.trim() || filters.status || filters.kind || filters.section || filters.flags.length || filters.fit || filters.origin);
  // Chips: the two main toggles, plus any other flag that is on (tap to turn it off).
  const toggles = [...TOGGLES, ...filters.flags.filter((f) => !TOGGLES.includes(f))];
  const more = MORE.filter((f) => !filters.flags.includes(f));
  const toggleFlag = (flag: SheetFlag) =>
    onChange({ ...filters, flags: filters.flags.includes(flag) ? filters.flags.filter((f) => f !== flag) : [...filters.flags, flag] });

  return (
    <div className="flex flex-col gap-2 pb-3 md:flex-row md:flex-wrap md:items-center md:gap-2 md:pb-0 md:pt-2">
      <SearchInput
        value={filters.q}
        onChange={(e) => onChange({ ...filters, q: e.currentTarget.value })}
        placeholder="Search organization, city, contact, phone…"
        aria-label="Search this campaign"
        className="md:w-64"
      />

      <div className={cn(scrollerClass, "-mx-4 gap-2 px-4 md:mx-0 md:contents md:px-0")}>

        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.currentTarget.value as OpportunityStage | "" })}
          aria-label="Status"
          className={cn(pillSelect, filters.status && "border-fg/70 font-medium")}
        >
          <option value="">All statuses</option>
          {statusOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label} ({s.count})
            </option>
          ))}
        </select>

        {goalOptions.length > 1 || filters.kind ? (
          <select
            value={filters.kind ?? ""}
            onChange={(e) => onChange({ ...filters, kind: e.currentTarget.value as OpportunityKind | "" })}
            aria-label="Goal"
            className={cn(pillSelect, "max-w-[14rem]", filters.kind && "border-fg/70 font-medium")}
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
            onChange={(e) => onChange({ ...filters, section: e.currentTarget.value })}
            aria-label="Section"
            className={cn(pillSelect, "max-w-[14rem]", filters.section && "border-fg/70 font-medium")}
          >
            <option value="">All sections{sectionCounts ? ` (${[...sectionCounts.values()].reduce((a, b) => a + b, 0)})` : ""}</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
                {sectionCounts?.has(s) ? ` (${sectionCounts.get(s)})` : ""}
              </option>
            ))}
            {hasUnsectioned ? (
              <option value={NO_SECTION}>No section{sectionCounts?.has("") ? ` (${sectionCounts.get("")})` : ""}</option>
            ) : null}
          </select>
        ) : null}

        <select
          value={filters.fit ?? ""}
          onChange={(e) => onChange({ ...filters, fit: e.currentTarget.value as FitFilter })}
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
          onChange={(e) => onChange({ ...filters, origin: e.currentTarget.value })}
          aria-label="Origin"
          title="Where the contact came from"
          className={cn(pillSelect, filters.origin && "border-fg/70 font-medium")}
        >
          <option value="">Any origin</option>
          {ORIGINS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {toggles.map((flag) => {
          const on = filters.flags.includes(flag);
          return (
            <button
              key={flag}
              type="button"
              aria-pressed={on}
              onClick={() => toggleFlag(flag)}
              className={cn(
                chip,
                on ? "border-accent bg-accent font-medium text-accent-fg" : "border-border bg-surface text-fg active:bg-surface-2 md:hover:bg-surface-2",
              )}
            >
              {on ? <Check className="size-3.5" strokeWidth={2.25} aria-hidden /> : null}
              {SHEET_FLAG_LABELS[flag]}
            </button>
          );
        })}

        {more.length ? (
          <select
            value=""
            onChange={(e) => {
              const flag = e.currentTarget.value as SheetFlag;
              if (flag) toggleFlag(flag);
            }}
            aria-label="More filters"
            className={cn(pillSelect, "text-muted")}
          >
            <option value="">More filters</option>
            {more.map((flag) => (
              <option key={flag} value={flag}>
                {SHEET_FLAG_LABELS[flag]}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="flex min-h-9 items-center gap-3 md:ml-auto md:min-h-0">
        <p className={cn("min-w-0 flex-1 truncate text-[13px] text-muted md:flex-none md:text-xs", !filtered && "md:hidden")} aria-live="polite">
          {filtered ? `${shown} of ${total}` : `${total} ${total === 1 ? "contact" : "contacts"}`}
          {filtered ? (
            <>
              {" · "}
              <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="font-medium text-fg/80 underline-offset-2 active:opacity-60 md:hover:underline">
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
          className={cn(chip, "h-9 md:hidden", compact ? "border-fg/70 font-medium text-fg" : "border-border bg-surface text-muted")}
        >
          <Rows3 className="size-4" strokeWidth={1.75} aria-hidden />
          Compact
        </button>
        <button
          type="button"
          aria-pressed={selectMode}
          onClick={() => onSelectMode(!selectMode)}
          className={cn(chip, "h-9 md:hidden", selectMode ? "border-accent bg-accent font-medium text-accent-fg" : "border-border bg-surface text-muted")}
        >
          <ListChecks className="size-4" strokeWidth={1.75} aria-hidden />
          {selectMode ? "Done" : "Select"}
        </button>
      </div>
    </div>
  );
}
