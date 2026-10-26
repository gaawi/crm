import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { upcomingGuestListEvents } from "@/lib/queries/guests";
import { ticketsSoldByEvent } from "@/lib/queries/ticket-sales";
import { DateTile, InsetGroup, LinkRow } from "../promotion/stage";

export const metadata: Metadata = { title: "Concert list" };

/** Every upcoming concert, soonest first: each opens its promotion, tickets sold, guest list and staff. */
export default async function ConcertListPage() {
  const events = await upcomingGuestListEvents();
  const sold = await ticketsSoldByEvent(events.map((e) => e.id));
  const [next, ...later] = events;
  const row = (e: (typeof events)[number]) => {
    const guests = e.guests - e.crew;
    const counts = [sold.has(e.id) ? `${sold.get(e.id)} sold` : null, guests ? `${guests} ${guests === 1 ? "guest" : "guests"}` : null].filter(Boolean).join(" · ");
    return (
      <LinkRow key={e.id} href={`/concerts/${e.id}`}>
        <DateTile startsAt={e.startsAt} timeZone={e.timeZone} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] text-fg md:text-sm">{e.title}</span>
          <span className="block truncate text-[13px] text-subtle md:text-xs">
            {new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(e.startsAt)}
            {counts ? ` · ${counts}` : e.venue ? ` · ${e.venue}` : ""}
          </span>
        </span>
      </LinkRow>
    );
  };

  return (
    <>
      <PageHeader title="Concert list" description="Promotion, tickets sold, guests and staff of each concert." />
      <div className="flex flex-col gap-8 md:max-w-2xl">
        {next ? (
          <>
            <InsetGroup title="Next concert">{row(next)}</InsetGroup>
            {later.length ? <InsetGroup title="Later">{later.map(row)}</InsetGroup> : null}
          </>
        ) : (
          <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-5 text-[15px] text-muted md:rounded-lg md:text-sm">
            <Ticket className="size-4" aria-hidden />
            No concerts coming up. Add one in Promotion.
          </p>
        )}
      </div>
    </>
  );
}
