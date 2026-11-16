"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import type { Explained } from "@/lib/booking/explain";
import { cn } from "@/lib/utils";

/** "Automatic" / "Manual" chip used in the info tips and next to automatic statuses. */
export function HowChip({ how, className }: { how: "auto" | "manual"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded px-1 text-[10px] font-semibold uppercase tracking-wide",
        how === "auto" ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
        className,
      )}
    >
      {how === "auto" ? "Auto" : "Manual"}
    </span>
  );
}

/**
 * A small (i) button that opens a panel explaining how each item is set
 * (automatic or by hand). Closes on a second tap, Escape or a tap outside.
 */
export function InfoTip({
  title,
  items,
  note,
  align = "left",
  className,
}: {
  title: string;
  items?: Explained[];
  note?: string;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className={cn("relative inline-flex shrink-0 items-center", className)}>
      <button
        type="button"
        aria-label={`How ${title.toLowerCase()} work`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-6 items-center justify-center rounded-full text-subtle hover:bg-surface-2 hover:text-fg md:size-5"
      >
        <Info className="size-3.5" strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <span
          id={id}
          role="dialog"
          aria-label={title}
          className={cn(
            "absolute top-full z-40 mt-1 block w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-3 text-left text-xs font-normal normal-case tracking-normal text-fg shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <span className="mb-1.5 block text-[13px] font-semibold">{title}</span>
          {items?.length ? (
            <span className="flex flex-col gap-1.5">
              {items.map((i) => (
                <span key={i.label} className="block">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">{i.label}</span>
                    <HowChip how={i.how} />
                  </span>
                  <span className="block text-muted">{i.text}</span>
                </span>
              ))}
            </span>
          ) : null}
          {note ? <span className="mt-2 block border-t border-border pt-2 text-muted">{note}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
