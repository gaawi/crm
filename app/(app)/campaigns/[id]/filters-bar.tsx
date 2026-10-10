"use client";

import { Check, ListChecks, Rows3 } from "lucide-react";
import { EMPTY_FILTERS, NO_SECTION, SHEET_FLAG_LABELS, type SheetFilters, type SheetFlag } from "@/lib/booking/filters";
import type { OpportunityKind, OpportunityStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SearchInput } from "../../_components/ui";
import { scrollerClass } from "./stats";

/** Toggles shown as chips ("hot" still works from a link: ?flag=hot). */
const TOGGLES: SheetFlag[] = ["due", "no_reply", "returning", "phone"];
const STAT_FLAGS: SheetFlag[] = ["due", "no_reply"];

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
  /** Some rows have no section (offers "No section"). */
  hasUnsectioned: boolean;
  shown: number;
  total: number;
  compact: boolean;
  onCompact: (compact: boolean) => void;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
}) {
  const filtered = Boolean(filters.q.trim() || filters.status || filters.kind || filters.section || filters.flags.length);
  const toggles = filters.flags.includes("hot") ? [...TOGGLES, "hot" as const] : TOGGLES;
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
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {hasUnsectioned ? <option value={NO_SECTION}>No section</option> : null}
          </select>
        ) : null}

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
                // Desktop: the counts right above toggle these two already (and show when they're on).
                STAT_FLAGS.includes(flag) && "md:hidden",
                on ? "border-accent bg-accent font-medium text-accent-fg" : "border-border bg-surface text-fg active:bg-surface-2 md:hover:bg-surface-2",
              )}
            >
              {on ? <Check className="size-3.5" strokeWidth={2.25} aria-hidden /> : null}
              {SHEET_FLAG_LABELS[flag]}
            </button>
          );
        })}
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
