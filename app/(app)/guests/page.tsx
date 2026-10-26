import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { upcomingGuestListEvents } from "@/lib/queries/guests";
import { DateTile, InsetGroup, LinkRow } from "../promotion/stage";

export const metadata: Metadata = { title: "Guest lists" };

/** Every upcoming concert's guest list (guests, then staff and artists), soonest first. */
export default async function GuestListsPage() {
  const events = await upcomingGuestListEvents();
  const [next, ...later] = events;
  const row = (e: (typeof events)[number]) => {
    const guests = e.guests - e.crew;
    const counts = [guests ? `${guests} · ${e.tickets} tix` : null, e.crew ? `${e.crew} crew` : null].filter(Boolean).join(" · ");
    return (
      <LinkRow key={e.id} href={`/promotion/c/${e.id}/guests`}>
        <DateTile startsAt={e.startsAt} timeZone={e.timeZone} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] text-fg md:text-sm">{e.title}</span>
          <span className="block truncate text-[13px] text-subtle md:text-xs">
            {new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(e.startsAt)}
            {e.venue ? ` · ${e.venue}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-[15px] tabular-nums text-muted md:text-xs">{counts || "Empty"}</span>
      </LinkRow>
    );
  };

  return (
    <>
      <PageHeader title="Guest lists" description="Who comes to each concert, and who works it." />
      <div className="flex flex-col gap-8 md:max-w-2xl">
        {next ? (
          <>
            <InsetGroup title="Next concert">{row(next)}</InsetGroup>
            {later.length ? <InsetGroup title="Later">{later.map(row)}</InsetGroup> : null}
            <p className="-mt-4 px-4 text-[13px] text-subtle md:text-xs">Add people from their email in Mail with one tap, or search your contacts on the list.</p>
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
