import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ListChecks, Ticket, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { formatRelative } from "@/lib/dates";
import { env } from "@/lib/env";
import { CREW_KINDS, listGuests } from "@/lib/queries/guests";
import { getListingEvent, platformsForEvent } from "@/lib/queries/listings";
import { ticketSales } from "@/lib/queries/ticket-sales";
import { concertGroups, CountsLine, InsetGroup, LinkRow } from "../../promotion/stage";
import { SalesRows } from "./sales";

export const metadata: Metadata = { title: "Concert" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rowText = "min-w-0 flex-1 text-[17px] text-fg md:text-sm";
const value = "shrink-0 text-[17px] tabular-nums text-muted md:text-sm";

/** One concert: where it is promoted, the tickets sold per channel, the guest list and the staff. */
export default async function ConcertPage({ params }: PageProps<"/concerts/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [event, sales, everyone] = await Promise.all([getListingEvent(id), ticketSales(id), listGuests(id)]);
  if (!event) notFound();
  const promotion = event.promote ? concertGroups(await platformsForEvent(id)).counts : null;
  const when = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(event.startsAt);
  const crew = everyone.filter((g) => CREW_KINDS.includes(g.kind) && !g.backup);
  const backups = everyone.filter((g) => CREW_KINDS.includes(g.kind) && g.backup).length;
  const guests = everyone.filter((g) => !CREW_KINDS.includes(g.kind));
  const reported = sales.filter((s) => s.sold !== null);
  const totalSold = reported.reduce((n, s) => n + (s.sold ?? 0), 0);
  const lastUpdate = reported.reduce<Date | null>((d, s) => (!d || s.updatedAt > d ? s.updatedAt : d), null);
  const guestsHref = `/promotion/c/${event.id}/guests`;

  return (
    <>
      <PageHeader title={event.title} description={[when, event.venue].filter(Boolean).join(" · ")} back={{ href: "/concerts", label: "Concert list" }} />
      <div className="flex flex-col gap-8 md:max-w-2xl">
        {promotion ? (
          <InsetGroup title="Promotion">
            <LinkRow href={`/promotion/c/${event.id}`}>
              <ListChecks className="size-5 shrink-0 text-pink-600 dark:text-pink-400" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[17px] text-fg md:text-sm">Listings &amp; partners</span>
                <CountsLine counts={promotion} />
              </span>
            </LinkRow>
          </InsetGroup>
        ) : null}

        <InsetGroup
          title="Tickets sold"
          aside={reported.length ? `${totalSold} total` : undefined}
          footer={`${lastUpdate ? `Updated ${formatRelative(lastUpdate, env.timezone)}. ` : ""}ChatGPT keeps these up to date; tap one to change it.`}
        >
          <SalesRows eventId={event.id} sales={sales.map((s) => ({ id: s.id, channel: s.channel, sold: s.sold, note: s.note }))} />
        </InsetGroup>

        <InsetGroup title="People">
          <LinkRow href={guestsHref}>
            <Ticket className="size-5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
            <span className={rowText}>Guest list</span>
            <span className={value}>{guests.length ? `${guests.length} · ${guests.reduce((n, g) => n + g.tickets, 0)} tix` : "Empty"}</span>
          </LinkRow>
          <LinkRow href={`${guestsHref}#staff`}>
            <Users className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <span className={rowText}>Staff &amp; artists</span>
            <span className={value}>
              {crew.length || (backups ? 0 : "None yet")}
              {backups ? ` + ${backups} backup${backups === 1 ? "" : "s"}` : ""}
            </span>
          </LinkRow>
        </InsetGroup>
      </div>
    </>
  );
}
