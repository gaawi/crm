import Link from "next/link";
import { FileDown } from "lucide-react";
import type { GuestListEvent } from "@/lib/queries/guests";

/** Concert day only: the door list one tap from Today, as soon as the app opens. */
export function ConcertTodayBlock({ events }: { events: GuestListEvent[] }) {
  if (!events.length) return null;
  return (
    <section className="flex flex-col gap-3">
      {events.map((e) => {
        const time = new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, hour: "numeric", minute: "2-digit" }).format(e.startsAt);
        return (
          <div key={e.id} className="rounded-xl border border-border bg-surface p-4 md:rounded-lg">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400 md:text-xs">Concert today</p>
            <Link href={`/concerts/${e.id}`} className="mt-0.5 block truncate text-[17px] font-semibold text-fg hover:underline md:text-base">
              {e.title}
            </Link>
            <p className="truncate text-[13px] text-muted md:text-xs">{[time, e.venue].filter(Boolean).join(" · ")}</p>
            <a
              href={`/api/door-list/${e.id}`}
              download
              className="mt-3 flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-brand px-4 text-[17px] font-semibold text-white active:opacity-90 md:min-h-11 md:rounded-lg md:text-sm"
            >
              <FileDown className="size-5" aria-hidden />
              Door list (PDF)
            </a>
          </div>
        );
      })}
    </section>
  );
}
