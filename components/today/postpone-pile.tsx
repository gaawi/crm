"use client";

import { useState, useTransition } from "react";
import { AlarmClock, Loader2 } from "lucide-react";
import { bringBackPileAction, postponePileAction } from "@/lib/assistant/actions";

const CHOICES = [
  { days: 1, label: "Tomorrow" },
  { days: 2, label: "In 2 days" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "In a week" },
];

/** Beside a pile on Today: "remind me in X days" for all its emails at once. */
export function PostponePile({ ids, name }: { ids: string[]; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (days: number) =>
    start(async () => {
      const r = await postponePileAction(ids, days).catch(() => ({ ok: false as const, error: "Not saved. Try again." }));
      if (!r.ok) setError(r.error ?? "Not saved. Try again.");
      else setOpen(false);
    });

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label={`Remind me later: ${name}`}
        aria-expanded={open}
        disabled={pending}
        onClick={() => {
          setOpen((o) => !o);
          setError(null);
        }}
        className="flex h-full min-h-[64px] w-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand/10 text-brand active:bg-brand/20 md:min-h-[56px] md:rounded-xl md:hover:bg-brand/15 dark:bg-brand/20"
      >
        {pending ? <Loader2 className="size-5 animate-spin" /> : <AlarmClock className="size-5" aria-hidden />}
        <span className="text-[10px] font-semibold leading-none">Later</span>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1.5 w-48 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <p className="border-b border-border px-3 py-2 text-[12px] text-muted">Remind me about all {ids.length} in…</p>
          {CHOICES.map((c) => (
            <button
              key={c.days}
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => pick(c.days)}
              className="block w-full px-3 py-2.5 text-left text-[15px] text-fg active:bg-surface-2 md:py-2 md:text-sm md:hover:bg-surface-2"
            >
              {c.label}
            </button>
          ))}
          {error ? <p className="px-3 py-2 text-[12px] text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A pile put off for later, under the live ones: small and faded (it is
 * there, but not for now), the day it comes back, and "Now" to bring it back.
 */
export function LaterPile({ ids, name, until }: { ids: string[]; name: string; until: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const day = until ? new Date(`${until}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-brand/30 bg-brand/[0.04] px-3 py-2 text-brand/70 dark:bg-brand/10">
      <AlarmClock className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-[13px] leading-tight md:text-xs">
        <span className="block truncate font-semibold">{name}</span>
        <span className="block truncate text-brand/60">
          {ids.length === 1 ? "1 email" : `${ids.length} emails`} for later{day ? ` · back ${day}` : ""}
          {error ? <span className="text-danger"> · {error}</span> : null}
        </span>
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await bringBackPileAction(ids).catch(() => ({ ok: false as const, error: "Not saved. Try again." }));
            if (!r.ok) setError(r.error);
          })
        }
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-brand active:bg-brand/10 md:h-7 md:text-xs md:hover:bg-brand/10"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Now
      </button>
    </div>
  );
}
