"use client";

import {
  Bot,
  Building2,
  Car,
  Check,
  ChevronRight,
  KeyRound,
  ListChecks,
  MapPin,
  Music,
  RotateCcw,
  SlidersHorizontal,
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
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/booking/info-tip";
import { AUTO_LOCK_NOTE, explainFlag } from "@/lib/booking/explain";
import { isFilterableTag, tagInfo, TAG_CATALOG, TAG_GROUPS } from "@/lib/booking/tag-catalog";
import { SearchInput } from "../../_components/ui";
import { scrollerClass, type StatItem } from "./stats";

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
    flag: "tour_nw",
    icon: MapPin,
    off: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
    on: "border-emerald-600 bg-emerald-600 text-white",
  },
  {
    flag: "tour_mw",
    icon: MapPin,
    off: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-300",
    on: "border-cyan-600 bg-cyan-600 text-white",
  },
  {
    flag: "rental",
    icon: KeyRound,
    off: "border-stone-300 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-300",
    on: "border-stone-600 bg-stone-600 text-white",
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

const chip =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[15px] transition-colors md:h-8 md:rounded-md md:px-2.5 md:text-sm";

export function FiltersBar({
  filters,
  onChange,
  goalOptions,
  sections,
  sectionCounts,
  flagCounts,
  tagCounts,
  summary,
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
  /** Rows carrying each organization tag (and fit-*), given the other filters. */
  tagCounts?: ReadonlyMap<string, number>;
  /** Of the rows the filters leave: how many we wrote to, how many replied… */
  summary?: { total: number; toContact: number; noReply: number; replied: number; offer: number; confirmed: number; declined: number };
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
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const filtered = Boolean(
    filters.q.trim() ||
    filters.status ||
    filters.kind ||
    filters.section ||
    filters.flags.length ||
    filters.fit ||
    filters.origin ||
    filters.tags?.length,
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

  // How many filters are on besides the search (shown on the Filters button).
  const activeCount =
    (filters.status ? 1 : 0) +
    (filters.kind ? 1 : 0) +
    (filters.section ? 1 : 0) +
    (filters.fit ? 1 : 0) +
    (filters.origin ? 1 : 0) +
    filters.flags.length +
    (filters.tags?.length ?? 0);

  return (
    <div className="flex flex-col gap-2 pb-3 md:pb-0 md:pt-2">
      <div className="flex items-center gap-2">
        <SearchInput
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.currentTarget.value })}
          placeholder="Search organization, city, contact…"
          aria-label="Search this campaign"
          className="min-w-0 flex-1 md:max-w-sm"
        />
        <button
          type="button"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => setPanelOpen((o) => !o)}
          className={cn(
            chip,
            "h-10 md:h-8",
            panelOpen || activeCount
              ? "border-fg/70 font-medium text-fg"
              : "border-border bg-surface text-muted",
          )}
        >
          <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
          Filters
          {activeCount ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-fg text-[11px] font-semibold text-bg">
              {activeCount}
            </span>
          ) : null}
        </button>
        {/* Phones: select mode (the desktop table always has checkboxes). */}
        <button
          type="button"
          aria-pressed={selectMode}
          aria-label={selectMode ? "Done selecting" : "Select rows"}
          title={selectMode ? "Done" : "Select"}
          onClick={() => onSelectMode(!selectMode)}
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-full md:hidden",
            selectMode ? "bg-accent text-accent-fg" : "text-muted active:bg-surface-2",
          )}
        >
          <ListChecks className="size-5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {filtered && summary ? (
        <ResultsSummary summary={summary} shown={shown} total={total} onClear={() => onChange(EMPTY_FILTERS)} />
      ) : null}

      {panelOpen ? (
        <div id={panelId} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 md:rounded-lg">
          <div className={cn(scrollerClass, "-mx-3 gap-2 px-3 md:mx-0 md:flex-wrap md:px-0")}>
            {/* Where each row stands: one choice at a time, with its count. */}
            <select
              value={stats.find((st) => st.active && st.key !== "total")?.key ?? ""}
              onChange={(e) => {
                const key = e.currentTarget.value;
                (stats.find((st) => st.key === (key || "total")) ?? stats[0])?.onClick();
              }}
              aria-label="Status"
              className={cn(pillSelect, "max-w-[16rem]", stats.some((st) => st.active && st.key !== "total") && "border-fg/70 font-medium")}
            >
              {stats.map((st) => (
                <option key={st.key} value={st.key === "total" ? "" : st.key}>
                  {st.key === "total" ? `Any status (${st.count})` : `${st.label} (${st.count})`}
                </option>
              ))}
            </select>
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
                aria-label="Category"
                className={cn(pillSelect, "max-w-[14rem]", filters.section && "border-fg/70 font-medium")}
              >
                <option value="">All categories</option>
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
          </div>

          {/* Organization tags by group: combine them (all must match); each shows how many rows it leaves. */}
          {filters.tags?.length ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted md:text-xs">
              <span>
                {filters.tags.length} tag{filters.tags.length === 1 ? "" : "s"} chosen. Rows must have
              </span>
              <span role="radiogroup" aria-label="How tags combine" className="inline-flex overflow-hidden rounded-full border border-border">
                {(["all", "any"] as const).map((m) => {
                  const on = (filters.tagMode ?? "all") === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => onChange({ ...filters, tagMode: m === "any" ? "any" : undefined })}
                      className={cn("h-9 px-3 font-medium md:h-7 md:px-2.5", on ? "bg-fg text-bg" : "bg-surface text-fg/80 active:bg-surface-2")}
                    >
                      {m === "all" ? "all of them (AND)" : "any of them (OR)"}
                    </button>
                  );
                })}
              </span>
            </div>
          ) : null}
          <TagPicker
            selected={filters.tags ?? []}
            counts={tagCounts}
            onToggle={(tag) => {
              const cur = filters.tags ?? [];
              const tags = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag];
              onChange({ ...filters, tags: tags.length ? tags : undefined, tagMode: tags.length > 1 ? filters.tagMode : undefined });
            }}
          />
          {/* Email details of each row (automatic) and the Returning mark. */}
          <section aria-label="Email details">
            <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <Bot className="size-3.5" strokeWidth={2} aria-hidden />
              Email details
              <InfoTip title="Email details" note={AUTO_LOCK_NOTE} items={DETAIL_FLAGS.map((f) => explainFlag(f)).filter((x): x is NonNullable<typeof x> => Boolean(x))} />
            </p>
            <div className="flex flex-wrap gap-1.5">{DETAIL_FLAGS.map((flag) => renderFlag(flag))}</div>
          </section>
          <label className="flex min-h-11 items-center gap-2 text-[15px] text-muted md:hidden">
            <input type="checkbox" checked={compact} onChange={(e) => onCompact(e.currentTarget.checked)} className="size-5" />
            Compact list (name, place and last interaction)
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** Row-level filters kept as toggles (the organization tags are in the tag picker). */
const DETAIL_FLAGS: SheetFlag[] = ["bounced", "auto_reply", "phone", "returning", "unresearched"];

const FIT_LABEL: Record<string, string> = { "fit-high": "Fit: high", "fit-medium": "Fit: medium", "fit-low": "Fit: low", "fit-unknown": "Fit: not researched" };

/** The tags grouped (What they are, Where, Our marks, Not a fit, From lists), each with its count. */
function TagPicker({
  selected,
  counts,
  onToggle,
}: {
  selected: string[];
  counts?: ReadonlyMap<string, number>;
  onToggle: (tag: string) => void;
}) {
  const present = [...new Set([...(counts?.keys() ?? []), ...selected])].filter((t) => isFilterableTag(t));
  const fit = present.filter((t) => t.startsWith("fit-")).sort();
  const byGroup = new Map<string, string[]>();
  for (const t of present) {
    if (t.startsWith("fit-")) continue;
    const g = tagInfo(t).group;
    byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
  }
  const order = new Map(TAG_CATALOG.map((t, i) => [t.tag, i]));
  const sortTags = (list: string[]) =>
    list.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || (counts?.get(b) ?? 0) - (counts?.get(a) ?? 0));
  const chipFor = (tag: string, label: string) => {
    const on = selected.includes(tag);
    const n = counts?.get(tag) ?? 0;
    return (
      <button
        key={tag}
        type="button"
        aria-pressed={on}
        onClick={() => onToggle(tag)}
        title={tagInfo(tag).text}
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-[14px] transition-colors md:h-7 md:px-2.5 md:text-xs",
          on ? "border-fg bg-fg text-bg" : "border-border bg-surface text-fg/80 active:bg-surface-2 md:hover:bg-surface-2",
        )}
      >
        {on ? <Check className="size-3.5" strokeWidth={2.25} aria-hidden /> : null}
        {label}
        <span className="tabular-nums opacity-60">{n}</span>
      </button>
    );
  };
  const groups = TAG_GROUPS.map((g) => ({ ...g, tags: sortTags(byGroup.get(g.key) ?? []) })).filter((g) => g.tags.length);
  return (
    <div className="flex flex-col gap-2">
      {fit.length ? (
        <section aria-label="Research fit">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Research fit</p>
          <div className="flex flex-wrap gap-1.5">{fit.map((t) => chipFor(t, FIT_LABEL[t] ?? t))}</div>
        </section>
      ) : null}
      {groups.map((g) => {
        const body = <div className="flex flex-wrap gap-1.5">{g.tags.map((t) => chipFor(t, tagInfo(t).label))}</div>;
        const title = (
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {g.title}
            <InfoTip title={g.title} note={g.hint} items={g.tags.filter((t) => tagInfo(t).group !== "lists").slice(0, 14).map((t) => ({ label: tagInfo(t).label, how: tagInfo(t).how, text: tagInfo(t).text }))} />
          </span>
        );
        return g.key === "lists" ? (
          <details key={g.key} className="group" open={g.tags.some((t) => selected.includes(t))}>
            <summary className="mb-1 flex cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 text-muted transition-transform group-open:rotate-90" aria-hidden />
              {title}
            </summary>
            {body}
          </details>
        ) : (
          <section key={g.key} aria-label={g.title}>
            <div className="mb-1">{title}</div>
            {body}
          </section>
        );
      })}
    </div>
  );
}

/** "128 shown · 64 to contact · 55 written, no reply · 9 replied (14%)…" for the rows the filters leave. */
function ResultsSummary({
  summary: s,
  shown,
  total,
  onClear,
}: {
  summary: { total: number; toContact: number; noReply: number; replied: number; offer: number; confirmed: number; declined: number };
  shown: number;
  total: number;
  onClear: () => void;
}) {
  const written = s.total - s.toContact;
  const answered = s.replied + s.offer + s.confirmed + s.declined;
  const pct = written ? Math.round((answered / written) * 100) : 0;
  const cell = (label: string, n: number, tone = "") => (
    <span className="flex flex-col">
      <span className={cn("text-[17px] font-semibold tabular-nums md:text-base", tone)}>{n}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 md:rounded-lg" aria-live="polite">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {cell("organizations", s.total)}
        {cell("to contact", s.toContact)}
        {cell("written", written)}
        {cell(`answered (${pct}%)`, answered, "text-emerald-700 dark:text-emerald-400")}
        {cell("no reply yet", s.noReply)}
        {s.offer ? cell("offer sent", s.offer) : null}
        {s.confirmed ? cell("confirmed", s.confirmed) : null}
        {s.declined ? cell("declined", s.declined) : null}
      </div>
      <p className="mt-1.5 text-[12px] text-muted">
        Showing {shown} of {total} ·{" "}
        <button type="button" onClick={onClear} className="font-medium text-fg/80 underline underline-offset-2 active:opacity-60">
          Clear filters
        </button>
      </p>
    </div>
  );
}
