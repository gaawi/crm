"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Loader2, Minus, Plus, Ticket, X } from "lucide-react";
import { addContactGuestAction, removeGuestAction, setGuestTicketsAction } from "@/app/(app)/promotion/guest-actions";
import { cn } from "@/lib/utils";

export interface PickerEvent {
  id: string;
  title: string;
  /** "Fri, Oct 30" */
  when: string;
}

export interface PickerEntry {
  id: string;
  eventId: string;
  tickets: number;
}

/**
 * The upcoming concerts, each with one tap to put this contact on its guest
 * list (2 tickets). Once on it: the tickets, − / +, and remove. Phone-sized
 * targets; the page refreshes from the server after each change.
 */
export function GuestPicker({ contactId, events, entries }: { contactId: string; events: PickerEvent[]; entries: PickerEntry[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!events.length) return null;
  const byEvent = new Map(entries.map((e) => [e.eventId, e]));

  const run = (key: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(key);
    setError(null);
    start(async () => {
      const result = await action().catch(() => ({ ok: false as const, error: "Not saved. Try again." }));
      if (!result.ok) setError(result.error);
      setBusy(null);
    });
  };
  const spinning = (key: string) => pending && busy === key;

  return (
    <div className="border-t border-border px-4 py-2.5 md:px-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[13px] text-muted md:text-xs">
        <Ticket className="size-3.5" aria-hidden />
        Guest list
      </p>
      <ul className="flex flex-col gap-1.5">
        {events.map((e) => {
          const entry = byEvent.get(e.id);
          return (
            <li key={e.id} className="flex min-h-11 items-center gap-2 md:min-h-8">
              <Link href={`/promotion/c/${e.id}/guests`} className="min-w-0 flex-1 truncate text-[15px] md:text-xs">
                <span className="font-medium text-fg">{e.title}</span> <span className="text-muted">· {e.when}</span>
              </Link>
              {entry ? (
                <span className="flex shrink-0 items-center gap-1">
                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700 md:text-xs dark:text-emerald-400">
                    <Check className="size-3.5" aria-hidden />
                  </span>
                  <button
                    type="button"
                    aria-label="One ticket less"
                    disabled={pending || entry.tickets <= 1}
                    onClick={() => run(`${e.id}-`, () => setGuestTicketsAction(entry.id, entry.tickets - 1))}
                    className="inline-flex size-9 items-center justify-center rounded-full border border-border text-fg active:bg-surface-2 disabled:opacity-40 md:size-6"
                  >
                    <Minus className="size-4 md:size-3" />
                  </button>
                  <span className="w-12 text-center text-[15px] tabular-nums md:w-9 md:text-xs">
                    {spinning(`${e.id}-`) || spinning(`${e.id}+`) ? <Loader2 className="mx-auto size-4 animate-spin" /> : `${entry.tickets} tix`}
                  </span>
                  <button
                    type="button"
                    aria-label="One ticket more"
                    disabled={pending || entry.tickets >= 20}
                    onClick={() => run(`${e.id}+`, () => setGuestTicketsAction(entry.id, entry.tickets + 1))}
                    className="inline-flex size-9 items-center justify-center rounded-full border border-border text-fg active:bg-surface-2 disabled:opacity-40 md:size-6"
                  >
                    <Plus className="size-4 md:size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove from the ${e.title} guest list`}
                    disabled={pending}
                    onClick={() => run(`${e.id}x`, () => removeGuestAction(entry.id))}
                    className="inline-flex size-9 items-center justify-center rounded-full text-subtle active:bg-surface-2 md:size-6"
                  >
                    {spinning(`${e.id}x`) ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4 md:size-3" />}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(`${e.id}add`, () => addContactGuestAction(e.id, contactId))}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-brand px-3.5 text-[15px] font-medium text-white active:opacity-80 disabled:opacity-60 md:h-7 md:px-2.5 md:text-xs",
                  )}
                >
                  {spinning(`${e.id}add`) ? <Loader2 className="size-4 animate-spin md:size-3.5" /> : <Plus className="size-4 md:size-3.5" />}
                  Add · 2
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-1 text-[13px] text-danger md:text-xs">{error}</p> : null}
    </div>
  );
}
