"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const defaultSummary =
  "flex size-10 cursor-pointer items-center justify-center rounded-full text-muted transition-colors active:bg-surface-2 md:size-8 md:rounded-md md:hover:bg-surface-2 md:hover:text-fg";
const defaultPanel = "right-0 mt-1 w-64 md:w-56";

/**
 * Menu on a native <details>: opens on tap/click (no hover), closes on an
 * outside tap, Escape, or when a link inside is followed. Items are server
 * rendered children (links, small forms).
 */
export function Dropdown({
  trigger,
  label,
  children,
  className,
  summaryClassName = defaultSummary,
  panelClassName = defaultPanel,
  positioned = true,
}: {
  trigger: ReactNode;
  /** Accessible name of the trigger. */
  label: string;
  children: ReactNode;
  className?: string;
  /** Replaces the default round icon-button look of the trigger. */
  summaryClassName?: string;
  /** Replaces the default placement/size of the panel (it is always absolute, below the trigger). */
  panelClassName?: string;
  /** false: the panel is placed relative to the nearest positioned ancestor instead of the trigger. */
  positioned?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close(event: Event) {
      const el = ref.current;
      if (el?.open && !el.contains(event.target as Node)) el.open = false;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && ref.current?.open) ref.current.open = false;
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details ref={ref} className={cn(positioned && "relative", "group/dropdown", className)}>
      <summary aria-label={label} title={label} className={cn("list-none [&::-webkit-details-marker]:hidden", summaryClassName)}>
        {trigger}
      </summary>
      <div
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a") && ref.current) ref.current.open = false;
        }}
        className={cn(
          "absolute top-full z-40 flex flex-col rounded-xl border border-border bg-surface p-1 shadow-lg md:rounded-lg",
          panelClassName,
        )}
      >
        {children}
      </div>
    </details>
  );
}
