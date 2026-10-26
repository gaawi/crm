import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink, Pencil, Ticket } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { listingBrief } from "@/lib/listings/brief";
import { listGuests } from "@/lib/queries/guests";
import { getListingEvent, platformsForEvent, type PlatformForEvent } from "@/lib/queries/listings";
import { cn } from "@/lib/utils";
import { CopyBrief, StatusCell } from "../../forms";
import { EventSheetRow } from "../../sheets";
import { concertGroups, CountsLine, InsetGroup, LinkRow, MethodIcon, methodName, ProgressBar, rowClass, statusOf, stageOf, ViewLink } from "../../stage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/promotion/c/[id]">): Promise<Metadata> {
  const { id } = await params;
  const event = UUID.test(id) ? await getListingEvent(id) : null;
  return { title: event ? `${event.title} · Promotion` : "Promotion" };
}

function when(e: { startsAt: Date; timeZone: string }): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(e.startsAt);
}

/** One concert's checklist: ticketing partners and listing sites, each with its status. */
export default async function PromotionConcertPage({ params }: PageProps<"/promotion/c/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [event, platforms, guests] = await Promise.all([getListingEvent(id), platformsForEvent(id), listGuests(id)]);
  if (!event) notFound();
  const { partners, always, sometimes, counts } = concertGroups(platforms);
  const started = sometimes.filter((p) => statusOf(p) !== "todo");
  const notStarted = sometimes.filter((p) => statusOf(p) === "todo");
  const done = (list: PlatformForEvent[]) => `${list.filter((p) => stageOf(p) !== "pending").length} of ${list.length} done`;

  return (
    <>
      <PageHeader title={event.title} description={[when(event), event.venue].filter(Boolean).join(" · ")} back={{ href: "/promotion", label: "Promotion" }} />
      <div className="flex flex-col gap-7 md:max-w-2xl">
        <InsetGroup>
          <li className="flex flex-col gap-2 px-4 py-3.5">
            <CountsLine counts={counts} className="text-[15px] md:text-sm" />
            <ProgressBar counts={counts} />
          </li>
          <li>
            <CopyBrief
              text={listingBrief(event, platforms)}
              pending={counts.pending + counts.sent}
              className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[17px] text-blue-600 active:bg-surface-2 md:min-h-11 md:text-sm dark:text-blue-400"
            />
          </li>
          {event.ticketUrl ? (
            <li>
              <a href={event.ticketUrl} target="_blank" rel="noreferrer noopener" className={cn(rowClass, "text-[17px] text-blue-600 active:bg-surface-2 md:text-sm dark:text-blue-400")}>
                <ExternalLink className="size-4" aria-hidden />
                <span className="flex-1">Tickets page</span>
              </a>
            </li>
          ) : null}
        </InsetGroup>

        {partners.length ? (
          <InsetGroup title="Ticketing partners" aside={done(partners)}>
            {partners.map((p) => (
              <SiteRow key={p.id} platform={p} eventId={event.id} />
            ))}
          </InsetGroup>
        ) : null}

        {always.length ? (
          <InsetGroup title="Listings, every concert" aside={done(always)}>
            {always.map((p) => (
              <SiteRow key={p.id} platform={p} eventId={event.id} />
            ))}
          </InsetGroup>
        ) : null}

        {sometimes.length ? (
          <InsetGroup title="Listings, some concerts" footer="Optional: send when the program fits their audience.">
            {[...started, ...notStarted].map((p) => (
              <SiteRow key={p.id} platform={p} eventId={event.id} />
            ))}
          </InsetGroup>
        ) : null}

        <InsetGroup title="Guest list">
          <LinkRow href={`/promotion/c/${event.id}/guests`}>
            <Ticket className="size-5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
            <span className="flex-1 text-[17px] text-fg md:text-sm">Guest list</span>
            <span className="text-[15px] tabular-nums text-muted md:text-xs">
              {guests.length ? `${guests.length} · ${guests.reduce((n, g) => n + g.tickets, 0)} tickets` : "Empty"}
            </span>
          </LinkRow>
        </InsetGroup>

        <InsetGroup title="Concert" footer="Date, venue, prices, links and the description the forms ask for.">
          <li>
            <EventSheetRow event={event} tone="plain" icon={<Pencil className="size-4 text-muted" aria-hidden />} label="Edit concert details" />
          </li>
        </InsetGroup>
      </div>
    </>
  );
}

/** Why a pending site is still pending, as ChatGPT (or whoever) noted it. */
function pendingReason(p: PlatformForEvent): string | null {
  if (stageOf(p) !== "pending") return null;
  if (p.submission?.pendingReason) return p.submission.pendingReason;
  return statusOf(p) === "blocked" ? "Blocked: no reason noted yet." : "Not sent yet.";
}

/**
 * A site in the checklist: tap the name for its screen, tap the status to
 * change it. Pending rows say what is holding them; published rows link to
 * the listing itself.
 */
function SiteRow({ platform: p, eventId }: { platform: PlatformForEvent; eventId: string }) {
  const s = p.submission;
  const stage = stageOf(p);
  const tickets =
    p.kind === "partner" && s && (s.ticketsOffered != null || s.memberPrice)
      ? [s.ticketsOffered != null ? `${s.ticketsOffered} tickets` : null, s.memberPrice, s.ticketsTaken != null ? `${s.ticketsTaken} taken` : null].filter(Boolean).join(" · ")
      : null;
  const detail =
    stage === "published" && !s?.publicUrl
        ? "No public link saved"
        : s?.sentAt
          ? s.sentAt
          : p.cost === "paid"
            ? "Paid"
            : null;
  const reason = pendingReason(p);
  return (
    <li className="flex min-h-[60px] items-stretch pr-4 md:min-h-12">
      <Link href={`/promotion/p/${p.id}?event=${eventId}`} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 active:bg-surface-2 md:hover:bg-surface-2">
        <MethodIcon method={p.method} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] leading-snug text-fg md:text-sm">{p.name}</span>
          <span className="block truncate text-[13px] text-subtle md:text-xs">
            {methodName(p.method)}
            {detail ? ` · ${detail}` : ""}
          </span>
          {tickets ? (
            <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[13px] font-medium text-violet-800 md:text-xs dark:bg-violet-950 dark:text-violet-200">
              <Ticket className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{tickets}</span>
            </span>
          ) : null}
          {reason ? <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-amber-700 md:text-xs dark:text-amber-400">{reason}</span> : null}
        </span>
      </Link>
      {stage === "published" && s?.publicUrl ? <ViewLink href={s.publicUrl} name={p.name} /> : null}
      <StatusCell key={`${p.id}-${statusOf(p)}`} eventId={eventId} platformId={p.id} status={statusOf(p)} />
    </li>
  );
}
