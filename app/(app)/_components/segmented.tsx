import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Segment {
  href: string;
  label: ReactNode;
  active: boolean;
  count?: number;
}

/**
 * iOS-style segmented control made of links (server-rendered, driven by a
 * search param). Segments share the width equally; labels truncate instead of
 * overflowing. `replace` keeps tab switches out of the back stack.
 */
export function Segmented({
  segments,
  label,
  className,
  fill = true,
}: {
  segments: Segment[];
  /** Accessible name, e.g. "Sections". */
  label: string;
  className?: string;
  /** Full width (default). false = only as wide as the labels on desktop. */
  fill?: boolean;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "grid auto-cols-fr grid-flow-col gap-0.5 rounded-[10px] bg-surface-2 p-0.5 md:rounded-lg",
        !fill && "md:inline-grid md:auto-cols-auto",
        className,
      )}
    >
      {segments.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          replace
          scroll={false}
          aria-current={s.active ? "page" : undefined}
          className={cn(
            "flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 text-[13px] font-medium transition-colors md:h-7 md:rounded-md md:px-3 md:text-xs",
            s.active
              ? "bg-surface text-fg shadow-sm dark:bg-border-strong"
              : "text-muted active:opacity-60 md:hover:text-fg",
          )}
        >
          <span className="truncate">{s.label}</span>
          {s.count !== undefined && s.count > 0 ? (
            <span className={cn("shrink-0 tabular-nums", s.active ? "text-muted" : "text-subtle")}>{s.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
