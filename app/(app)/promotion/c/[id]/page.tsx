import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight, ExternalLink, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { listingBrief } from "@/lib/listings/brief";
import { getListingEvent, platformsForEvent, type PlatformForEvent } from "@/lib/queries/listings";
import { cn } from "@/lib/utils";
import { CopyBrief, EventForm, StatusCell } from "../../forms";
import { concertGroups, InsetGroup, MethodIcon, methodName, ProgressBar, rowClass, statusOf, stageOf } from "../../stage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/promotion/c/[id]">): Promise<Metadata> {
  const { id } = await params;
  const event = UUID.test(id) ? await getListingEvent(id) : null;
  return { title: event ? `${event.title} · Promotion` : "Promotion" };
}

function when(e: { startsAt: Date; timeZone: string }): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(e.startsAt);
}

const plainSummary = "flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 active:bg-surface-2 md:min-h-11 [&::-webkit-details-marker]:hidden";

/** One concert's checklist: ticketing partners and listing sites, each with its status. */
export default async function PromotionConcertPage({ params }: PageProps<"/promotion/c/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [event, platforms] = await Promise.all([getListingEvent(id), platformsForEvent(id)]);
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
          <li className="p-4">
            <div className="grid grid-cols-3 text-center">
              <Stat n={counts.pending} label="Pending" className="text-amber-600 dark:text-amber-400" />
              <Stat n={counts.sent} label="Sent" className="text-blue-600 dark:text-blue-400" />
              <Stat n={counts.published} label="Published" className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <ProgressBar counts={counts} className="mt-4" />
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
            {started.map((p) => (
              <SiteRow key={p.id} platform={p} eventId={event.id} />
            ))}
            {notStarted.length ? (
              <li>
                <details className="group">
                  <summary className={plainSummary}>
                    <span className="flex-1 text-[17px] text-fg md:text-sm">{started.length ? "The others" : "Show them"}</span>
                    <span className="text-[17px] text-muted md:text-sm">{notStarted.length}</span>
                    <ChevronRight className="size-5 text-subtle/70 transition-transform group-open:rotate-90" aria-hidden />
                  </summary>
                  <ul className="border-t border-border [&>li+li]:border-t [&>li+li]:border-border">
                    {notStarted.map((p) => (
                      <SiteRow key={p.id} platform={p} eventId={event.id} />
                    ))}
                  </ul>
                </details>
              </li>
            ) : null}
          </InsetGroup>
        ) : null}

        <InsetGroup title="Concert" footer="Date, venue, prices, links and the description the forms ask for.">
          <li>
            <details className="group">
              <summary className={plainSummary}>
                <Pencil className="size-4 text-muted" aria-hidden />
                <span className="flex-1 text-[17px] text-fg md:text-sm">Edit concert details</span>
                <ChevronRight className="size-5 text-subtle/70 transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              <div className="border-t border-border px-4 py-4">
                <EventForm event={event} />
              </div>
            </details>
          </li>
        </InsetGroup>
      </div>
    </>
  );
}

function Stat({ n, label, className }: { n: number; label: string; className: string }) {
  return (
    <div>
      <p className={cn("text-[28px] font-semibold leading-none tabular-nums md:text-2xl", className)}>{n}</p>
      <p className="mt-1 text-[13px] text-muted md:text-xs">{label}</p>
    </div>
  );
}

/** A site in the checklist: tap the name for its screen, tap the status to change it. */
function SiteRow({ platform: p, eventId }: { platform: PlatformForEvent; eventId: string }) {
  const s = p.submission;
  const detail =
    p.kind === "partner" && s && (s.ticketsOffered != null || s.memberPrice)
      ? [s.ticketsOffered != null ? `${s.ticketsOffered} tickets` : null, s.memberPrice, s.ticketsTaken != null ? `${s.ticketsTaken} taken` : null].filter(Boolean).join(" · ")
      : s?.sentAt
        ? s.sentAt
        : p.cost === "paid"
          ? "Paid"
          : null;
  return (
    <li className="flex min-h-[60px] items-stretch pr-4 md:min-h-12">
      <Link href={`/promotion/p/${p.id}?event=${eventId}`} className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 active:bg-surface-2 md:hover:bg-surface-2">
        <MethodIcon method={p.method} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] leading-snug text-fg md:text-sm">{p.name}</span>
          <span className="block truncate text-[13px] text-subtle md:text-xs">
            {methodName(p.method)}
            {detail ? ` · ${detail}` : ""}
          </span>
        </span>
        {s?.publicUrl ? <ExternalLink className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Has a public listing" /> : null}
      </Link>
      <StatusCell key={`${p.id}-${statusOf(p)}`} eventId={eventId} platformId={p.id} status={statusOf(p)} />
    </li>
  );
}
