import Link from "next/link";
import { ChevronRight, FileDown, Ticket } from "lucide-react";
import type { ConcertToday } from "@/lib/queries/listings";

/**
 * Concert day: a big link straight to the door list (check-in), plus the PDF.
 * Shown at the top of Today only on the day of the concert, where it happens.
 */
export function ConcertTodayBlock({ concerts }: { concerts: ConcertToday[] }) {
  if (!concerts.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {concerts.map((c) => {
        const time = new Intl.DateTimeFormat("en-US", { timeZone: c.timeZone, hour: "numeric", minute: "2-digit" }).format(c.startsAt);
        return (
          <div key={c.id} className="flex gap-2">
            <Link
              href={`/promotion/c/${c.id}/guests`}
              className="flex min-h-[60px] min-w-0 flex-1 items-center gap-3 rounded-xl bg-brand px-4 py-2.5 text-white active:opacity-90 md:min-h-14 md:rounded-lg"
            >
              <Ticket className="size-6 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold leading-tight md:text-[15px]">Door list: {c.title}</span>
                <span className="block truncate text-[13px] text-white/80 md:text-xs">
                  {["Tonight " + time, c.venue, c.people ? `${c.checkedIn} of ${c.people} in` : "Nobody on the list yet"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-white/80" aria-hidden />
            </Link>
            <a
              href={`/api/door-list/${c.id}?view=1`}
              target="_blank"
              rel="noopener"
              title="Door list (PDF)"
              aria-label={`Door list PDF for ${c.title}`}
              className="flex w-14 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-fg active:bg-surface-2 md:rounded-lg"
            >
              <FileDown className="size-5" aria-hidden />
            </a>
          </div>
        );
      })}
    </div>
  );
}
