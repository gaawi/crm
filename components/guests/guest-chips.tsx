"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Loader2, Minus, Plus, Ticket } from "lucide-react";
import { addContactGuestAction, guestEntriesAction, removeGuestAction, setGuestTicketsAction } from "@/app/(app)/promotion/guest-actions";
import { cn } from "@/lib/utils";
import type { PickerEntry, PickerEvent } from "./guest-picker";

/**
 * The guest lists as one row of chips, for an approval card: tap a concert to
 * put this contact on its list (2 tickets); once on it, − / + change the
 * tickets (− at 1 takes them off). Taps never reach the card underneath.
 */
export function GuestChips({ contactId, events }: { contactId: string; events: PickerEvent[] }) {
  const [entries, setEntries] = useState<PickerEntry[] | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    guestEntriesAction(contactId)
      .then((e) => live && setEntries(e))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [contactId]);

  if (!events.length) return null;
  const byEvent = new Map((entries ?? []).map((e) => [e.eventId, e]));

  const run = (key: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(key);
    setError(null);
    start(async () => {
      const result = await action().catch(() => ({ ok: false as const, error: "Not saved. Try again." }));
      if (result.ok) setEntries(await guestEntriesAction(contactId).catch(() => entries ?? []));
      else setError(result.error);
      setBusy(null);
    });
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <section aria-label="Guest list" className="mt-1 flex flex-col gap-1.5" onClick={stop} onPointerDown={stop}>
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        <Ticket className="size-3.5" aria-hidden />
        Guest list
      </p>
      <div className="flex flex-wrap gap-1.5">
        {events.map((e) => {
          const entry = byEvent.get(e.id);
          const spinning = pending && busy?.startsWith(e.id);
          if (!entry) {
            return (
              <button
                key={e.id}
                type="button"
                disabled={pending || entries === null}
                onClick={() => run(`${e.id}add`, () => addContactGuestAction(e.id, contactId))}
                className="inline-flex h-9 items-center gap-1 rounded-full border border-violet-300 px-3 text-[13px] font-medium text-violet-800 active:bg-violet-50 disabled:opacity-60 dark:border-violet-800 dark:text-violet-200 dark:active:bg-violet-950"
              >
                {spinning ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                {e.title} · {e.when}
              </button>
            );
          }
          return (
            <span
              key={e.id}
              className={cn("inline-flex h-9 items-center gap-0.5 rounded-full bg-violet-600 pl-3 pr-1 text-[13px] font-medium text-white dark:bg-violet-700")}
            >
              <Check className="mr-0.5 size-3.5" aria-hidden />
              {e.title} · {spinning ? <Loader2 className="mx-1 size-3.5 animate-spin" /> : `${entry.tickets}`}
              <button
                type="button"
                aria-label={entry.tickets <= 1 ? `Take off the ${e.title} guest list` : "One ticket less"}
                disabled={pending}
                onClick={() =>
                  run(`${e.id}-`, () => (entry.tickets <= 1 ? removeGuestAction(entry.id) : setGuestTicketsAction(entry.id, entry.tickets - 1)))
                }
                className="ml-1 inline-flex size-7 items-center justify-center rounded-full bg-white/20 active:bg-white/30"
              >
                <Minus className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label="One ticket more"
                disabled={pending || entry.tickets >= 20}
                onClick={() => run(`${e.id}+`, () => setGuestTicketsAction(entry.id, entry.tickets + 1))}
                className="inline-flex size-7 items-center justify-center rounded-full bg-white/20 active:bg-white/30"
              >
                <Plus className="size-3.5" />
              </button>
            </span>
          );
        })}
      </div>
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </section>
  );
}
