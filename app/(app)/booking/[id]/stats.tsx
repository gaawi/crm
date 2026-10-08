"use client";

import Link from "next/link";
import { CircleCheck } from "lucide-react";
import type { SheetRow } from "@/lib/booking/types";
import { cn } from "@/lib/utils";
import { venueName } from "./row-meta";

/** Horizontal scroller without a visible scrollbar (phones swipe it). */
export const scrollerClass = "flex overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export interface StatItem {
  key: string;
  label: string;
  count: number;
  active: boolean;
  /** Stage color dot. */
  dot?: string;
  /** Colors the number when it is above zero. */
  tone?: "danger" | "warning";
  onClick: () => void;
}

/**
 * The sheet's counts (Total · To contact · … · Follow-ups due · No reply).
 * Each one filters the list; tapping the active one again clears it.
 */
export function StatsStrip({ items }: { items: StatItem[] }) {
  return (
    <div role="toolbar" aria-label="Counts (tap to filter)" className={cn(scrollerClass, "-mx-4 gap-1.5 px-4 py-2 md:mx-0 md:flex-wrap md:gap-1 md:px-0 md:py-0")}>
      {items.map((item) => {
        // One text color only: `cn` joins classes, and text-fg would beat text-danger.
        const toneClass = item.count > 0 && item.tone === "danger" ? "text-danger" : item.count > 0 && item.tone === "warning" ? "text-warning" : "text-fg";
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={item.active}
            onClick={item.onClick}
            className={cn(
              "flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 transition-colors md:h-8 md:gap-1 md:rounded-lg md:px-2",
              item.active
                ? "border-fg/70 bg-surface shadow-sm"
                : "border-border bg-surface active:bg-surface-2 md:hover:bg-surface-2",
            )}
          >
            {item.dot ? <span className={cn("size-2 shrink-0 rounded-full", item.dot)} aria-hidden /> : null}
            <span className={cn("text-[17px] font-semibold tabular-nums leading-none md:text-sm", toneClass)}>{item.count}</span>
            <span className={cn("whitespace-nowrap text-[13px] leading-none md:text-xs", item.active ? "text-fg" : "text-muted")}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Chips of the confirmed venues (with their contact), each linking to the
 * organization. `label` names the won stage for the sheet ("Confirmed";
 * "Achieved" when the sheet mixes goals).
 */
export function ConfirmedStrip({ rows, label: title = "Confirmed" }: { rows: SheetRow[]; label?: string }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title} className="mb-4 flex min-w-0 items-center gap-2 md:mb-5">
      <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-emerald-700 md:text-xs dark:text-emerald-400">
        <CircleCheck className="size-4 md:size-3.5" strokeWidth={2} aria-hidden />
        {title} <span className="tabular-nums">{rows.length}</span>
      </span>
      <ul className={cn(scrollerClass, "min-w-0 flex-1 gap-1.5 md:flex-wrap")}>
        {rows.map((row) => {
          const label = (
            <>
              <span className="font-medium text-fg">{venueName(row)}</span>
              {row.contact ? <span className="text-muted"> · {row.contact.displayName}</span> : null}
            </>
          );
          const chip =
            "flex h-9 max-w-[16rem] shrink-0 items-center truncate rounded-full border border-emerald-200 bg-emerald-50/60 px-3 text-[13px] dark:border-emerald-900 dark:bg-emerald-950/40 md:h-7 md:text-xs";
          return (
            <li key={row.id} className="min-w-0 shrink-0">
              {row.organization ? (
                <Link href={`/organizations/${row.organization.id}`} className={cn(chip, "active:opacity-60 md:hover:border-emerald-300")}>
                  <span className="truncate">{label}</span>
                </Link>
              ) : (
                <span className={chip}>
                  <span className="truncate">{label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
