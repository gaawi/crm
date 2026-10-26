"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import { addContactGuestAction, guestEntriesAction, removeGuestAction, setGuestTicketsAction } from "@/app/(app)/promotion/guest-actions";
import { cn } from "@/lib/utils";
import type { PickerEntry, PickerEvent } from "./guest-picker";

type Done = { ok: true } | { ok: false; error: string };

/**
 * Guest lists on an approval card: the next concert as one row (date tile,
 * title, status), "More concerts" for the rest. Add puts the contact on the
 * list with 2 tickets; on the list, the row turns green with − / +. Taps stay
 * here and never move the card underneath.
 */
export function GuestChips({ contactId, events }: { contactId: string; events: PickerEvent[] }) {
  const [entries, setEntries] = useState<PickerEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
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
  // Concerts this person is already on stay visible even when folded.
  const shown = more ? events : events.filter((e, i) => i === 0 || byEvent.has(e.id));
  const hidden = events.length - shown.length;

  const run = (eventId: string, action: () => Promise<Done>, confirm = false) => {
    setBusy(eventId);
    setError(null);
    start(async () => {
      const result = await action().catch(() => ({ ok: false as const, error: "Not saved. Try again." }));
      if (result.ok) {
        setEntries(await guestEntriesAction(contactId).catch(() => entries ?? []));
        if (confirm) {
          setAdded(eventId);
          setTimeout(() => setAdded((a) => (a === eventId ? null : a)), 3000);
        }
      } else setError(result.error);
      setBusy(null);
    });
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <section aria-label="Guest list" className="mt-2 flex flex-col gap-1.5" onClick={stop} onPointerDown={stop}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Guest list</p>
      <ul className="flex flex-col gap-1.5">
        {shown.map((e) => {
          const entry = byEvent.get(e.id);
          const spinning = pending && busy === e.id;
          return (
            <li
              key={e.id}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors",
                entry ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40" : "border-border bg-surface",
              )}
            >
              <span
                className={cn(
                  "relative flex size-10 shrink-0 flex-col items-center justify-center rounded-lg leading-none",
                  entry ? "bg-emerald-600 text-white" : "bg-surface-2 text-fg",
                )}
                aria-hidden
              >
                <span className={cn("text-[9px] font-semibold uppercase tracking-wide", entry ? "text-white/85" : "text-red-600 dark:text-red-400")}>
                  {e.month}
                </span>
                <span className="text-[16px] font-semibold tabular-nums">{e.day}</span>
              </span>
              <Link href={`/promotion/c/${e.id}/guests`} className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium leading-tight text-fg">{e.title}</span>
                <span className={cn("mt-0.5 flex items-center gap-1 text-[12px]", entry ? "font-medium text-emerald-700 dark:text-emerald-300" : "text-muted")}>
                  {entry ? (
                    <>
                      <Check className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{added === e.id ? "Added" : `On the list · ${entry.tickets} ${entry.tickets === 1 ? "ticket" : "tickets"}`}</span>
                      <ChevronRight className="size-3 shrink-0" aria-hidden />
                    </>
                  ) : (
                    <>
                      See list
                      <ChevronRight className="size-3 shrink-0" aria-hidden />
                    </>
                  )}
                </span>
              </Link>
              {entry ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={entry.tickets <= 1 ? `Take off the ${e.title} guest list` : "One ticket less"}
                    disabled={pending}
                    onClick={() => run(e.id, () => (entry.tickets <= 1 ? removeGuestAction(entry.id) : setGuestTicketsAction(entry.id, entry.tickets - 1)))}
                    className="inline-flex size-9 items-center justify-center rounded-full border border-emerald-300 bg-surface text-fg active:bg-surface-2 dark:border-emerald-800"
                  >
                    <Minus className="size-4" />
                  </button>
                  <span className="w-5 text-center text-[15px] font-semibold tabular-nums text-fg">
                    {spinning ? <Loader2 className="mx-auto size-4 animate-spin" /> : entry.tickets}
                  </span>
                  <button
                    type="button"
                    aria-label="One ticket more"
                    disabled={pending || entry.tickets >= 20}
                    onClick={() => run(e.id, () => setGuestTicketsAction(entry.id, entry.tickets + 1))}
                    className="inline-flex size-9 items-center justify-center rounded-full border border-emerald-300 bg-surface text-fg active:bg-surface-2 dark:border-emerald-800"
                  >
                    <Plus className="size-4" />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={pending || entries === null}
                  onClick={() => run(e.id, () => addContactGuestAction(e.id, contactId), true)}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-3.5 text-[14px] font-medium text-fg active:bg-surface-2 disabled:opacity-60"
                >
                  {spinning ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Add · 2
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 || more ? (
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          className="flex min-h-9 items-center gap-1 self-start text-[13px] font-medium text-blue-600 dark:text-blue-400"
        >
          <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} aria-hidden />
          {more ? "Fewer concerts" : `More concerts (${hidden})`}
        </button>
      ) : null}
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
    </section>
  );
}
