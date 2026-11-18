"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
              <div className="group/row flex items-center">
                <div className="min-w-0 flex-1">{it.row}</div>
                {/* Desktop: no swipe with a mouse, so a button on the row. */}
                <button
                  type="button"
                  title="Archive this campaign"
                  aria-label={`Archive ${it.name}`}
                  onClick={() => {
                    setGone((g) => new Set(g).add(it.id));
                    start(() => setSheetArchivedAction(it.id, true));
                  }}
                  className="mr-2 hidden size-8 shrink-0 items-center justify-center rounded-md text-subtle opacity-60 hover:bg-surface-2 hover:text-fg group-hover/row:opacity-100 md:inline-flex"
                >
                  <Archive className="size-4" aria-hidden />
                </button>
              </div>
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

/** "Archive campaign" inside a campaign (desktop button / phone menu item): archives it and goes back to the list. */
export function ArchiveSheetButton({ id, className, label = "Archive campaign" }: { id: string; className?: string; label?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Archive this campaign? It leaves the list and Today; nothing is deleted, and you can bring it back from Archived.")) return;
        start(async () => {
          await setSheetArchivedAction(id, true);
          router.push("/campaigns");
        });
      }}
      className={className}
    >
      <Archive className="size-4 text-muted" aria-hidden /> {pending ? "Archiving…" : label}
    </button>
  );
}
