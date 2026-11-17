"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Archive } from "lucide-react";
import { SwipeRow } from "@/components/mail/swipe-row";
import { setSheetArchivedAction } from "./actions";

/**
 * The campaigns list with the iPhone gesture: swipe a campaign to the left to
 * reveal Archive (a long swipe archives it). Archived campaigns move to the
 * Archived section at the bottom, from where they come back.
 */
export function SheetSwipeList({ items }: { items: { id: string; name: string; row: ReactNode }[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [, start] = useTransition();
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
      {items
        .filter((it) => !gone.has(it.id))
        .map((it) => (
          <li key={it.id}>
            <SwipeRow
              open={openId === it.id}
              onOpenChange={(open) => setOpenId(open ? it.id : null)}
              primary={{
                label: "Archive",
                icon: Archive,
                tone: "bg-zinc-500",
                removes: true,
                run: () => {
                  setGone((g) => new Set(g).add(it.id));
                  start(() => setSheetArchivedAction(it.id, true));
                },
              }}
            >
              {it.row}
            </SwipeRow>
          </li>
        ))}
    </ul>
  );
}

export function UnarchiveButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => setSheetArchivedAction(id, false))}
      className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-[15px] font-medium text-blue-600 active:opacity-60 md:min-h-8 md:text-sm dark:text-blue-400"
    >
      {pending ? "Restoring…" : "Unarchive"}
    </button>
  );
}
