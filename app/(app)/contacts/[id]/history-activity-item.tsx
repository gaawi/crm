"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { deleteActivityAction } from "@/app/(app)/activity-actions";
import { emitActivityChanged } from "@/components/booking/activity-events";

/**
 * The client half of a logged call / note in the contact's history. Like the
 * emails around it, the row expands on tap (native <details>) to show when
 * it was logged and Delete, which asks first and hides the row right away
 * (it comes back with the error if deleting fails; otherwise refresh()
 * re-renders the page without it).
 */
export function HistoryActivityItem({
  activityId,
  what,
  link,
  details,
  children,
}: {
  activityId: string;
  /** For the confirm and the button label: "this call", "this status entry". */
  what: string;
  /** Ids the activity belongs to, for ACTIVITY_CHANGED_EVENT listeners. */
  link: { opportunityId: string | null; contactId: string | null; organizationId: string | null };
  /** Shown when expanded, before Delete (full date and time…). */
  details: ReactNode;
  /** The row (server-rendered). */
  children: ReactNode;
}) {
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (deleted) return null;

  function remove() {
    if (!window.confirm(`Delete ${what} from the history?`)) return;
    setError(null);
    setDeleted(true);
    startTransition(async () => {
      const result = await deleteActivityAction(activityId).catch(() => ({ ok: false as const, error: "Not deleted. Try again." }));
      if (!result.ok && result.error !== "Already deleted") {
        setDeleted(false);
        setError(result.error);
        return;
      }
      emitActivityChanged(link);
    });
  }

  return (
    <li>
      <details className="group" open={error ? true : undefined}>
        <summary className="flex cursor-pointer list-none gap-3 px-4 py-3 active:bg-surface-2 md:hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
          {children}
        </summary>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-bg/40 px-4 py-1.5 text-xs text-muted md:py-1 md:pl-11">
          {details}
          <button
            type="button"
            onClick={remove}
            aria-label={`Delete ${what}`}
            className="-mr-2 ml-auto inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-[13px] text-danger active:opacity-60 md:-mr-1.5 md:h-7 md:text-xs md:hover:bg-surface-2"
          >
            <Trash2 className="size-4 md:size-3.5" strokeWidth={1.75} aria-hidden />
            Delete
          </button>
          {error ? (
            <p role="alert" className="w-full pb-1.5 text-[13px] text-danger md:text-xs">
              {error}
            </p>
          ) : null}
        </div>
      </details>
    </li>
  );
}
