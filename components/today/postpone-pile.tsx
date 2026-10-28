"use client";

import { useState, useTransition } from "react";
import { AlarmClock, Loader2 } from "lucide-react";
import { postponePileAction } from "@/lib/assistant/actions";

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
