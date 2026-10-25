import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, ExternalLink, Pencil, Plus, Ticket } from "lucide-react";
import { EmptyState, Notice, PageHeader } from "@/components/ui/layout";
import { listingBrief } from "@/lib/listings/brief";
import { getListingEvent, listListingEvents, platformsForEvent, type EventSummary, type ListingEvent, type PlatformForEvent } from "@/lib/queries/listings";
import { cn } from "@/lib/utils";
import { param } from "../_lib/url";
import { CopyBrief, EventForm, PlatformForm, StatusPicker } from "./forms";
import { MethodTag, splitByDate, STAGE_DOT, STAGE_OF, stageOf, statusOf, type Stage } from "./stage";

export const metadata: Metadata = { title: "Promotion" };

function shortDate(e: { startsAt: Date; timeZone: string }): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(e.startsAt);
}

/** Before the promotion migration is applied, the tables do not exist yet. */
async function eventsOrMissing(): Promise<EventSummary[] | null> {
  try {
    return await listListingEvents();
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

const summaryClass = "flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden";

export default async function PromotionPage({ searchParams }: PageProps<"/promotion">) {
  const sp = await searchParams;
  const all = await eventsOrMissing();
  if (!all) {
    return (
      <>
        <PageHeader title="Promotion" />
        <Notice tone="warning">
          The promotion tables are not in the database yet: run supabase/migrations/20261025000000_listings.sql in the Supabase SQL editor, then reload.
        </Notice>
      </>
    );
  }
  const { upcoming, past } = splitByDate(all);
  const loaded = await Promise.all(
    [...upcoming, ...past].map(async (s) => {
      const [event, platforms] = await Promise.all([getListingEvent(s.id), platformsForEvent(s.id)]);
      return { event: event!, platforms };
    }),
  );
  const wanted = param(sp, "event", 40);
  const openId = all.some((e) => e.id === wanted) ? wanted : upcoming[0]?.id;
  const skipped = loaded[0]?.platforms.filter((p) => p.tier === "skip") ?? [];

  return (
    <>
      <PageHeader title="Promotion" description="Concert by concert: the ticketing partners and listings each one goes to, and what is pending, sent or published." />

      {!all.length ? <EmptyState title="No concert yet">Add the concert you want to promote below.</EmptyState> : null}

      <div className="flex flex-col gap-3">
        {loaded.slice(0, upcoming.length).map(({ event, platforms }) => (
          <ConcertCard key={event.id} event={event} platforms={platforms} open={event.id === openId} />
        ))}
      </div>

      {past.length ? (
        <details className="group mt-5" open={past.some((e) => e.id === wanted)}>
          <summary className={cn(summaryClass, "min-h-10 px-4 text-xs font-medium uppercase tracking-wide text-subtle md:px-0")}>
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            Past concerts ({past.length})
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {loaded.slice(upcoming.length).map(({ event, platforms }) => (
              <ConcertCard key={event.id} event={event} platforms={platforms} open={event.id === wanted} />
            ))}
          </div>
        </details>
      ) : null}

      <div className="mt-6 flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <details className="group rounded-xl border border-border bg-surface md:rounded-lg">
            <summary className={cn(summaryClass, "min-h-12 px-4 text-[15px] text-fg active:opacity-60 md:min-h-10 md:text-sm")}>
              <Plus className="size-4 text-muted" aria-hidden />
              Add a concert
            </summary>
            <div className="px-4 pb-4">
              <EventForm />
            </div>
          </details>
          <details className="group rounded-xl border border-border bg-surface md:rounded-lg">
            <summary className={cn(summaryClass, "min-h-12 px-4 text-[15px] text-fg active:opacity-60 md:min-h-10 md:text-sm")}>
              <Plus className="size-4 text-muted" aria-hidden />
              Add a partner or listing site
            </summary>
            <div className="px-4 pb-4">
              <PlatformForm />
            </div>
          </details>
        </div>
        {skipped.length ? (
          <details className="group rounded-xl border border-border bg-surface md:rounded-lg">
            <summary className={cn(summaryClass, "min-h-12 px-4 text-[15px] text-muted active:opacity-60 md:min-h-10 md:text-sm")}>
              <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
              Not worth it ({skipped.length}), kept for reference
            </summary>
            <ul className="flex flex-col divide-y divide-border border-t border-border">
              {skipped.map((p) => (
                <li key={p.id}>
                  <Link href={`/promotion/p/${p.id}`} className="flex min-h-11 items-center gap-2 px-4 text-[15px] text-muted active:bg-surface-2 md:min-h-9 md:text-sm md:hover:bg-surface-2">
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <MethodTag method={p.method} />
                    <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </>
  );
}

const count = (list: PlatformForEvent[], stage: Stage) => list.filter((p) => stageOf(p) === stage).length;

/** One concert: a one-line summary that opens into its checklist. */
function ConcertCard({ event, platforms, open }: { event: ListingEvent; platforms: PlatformForEvent[]; open: boolean }) {
  const routine = platforms.filter((p) => p.tier !== "skip");
  const partners = routine.filter((p) => p.kind === "partner");
  const listings = routine.filter((p) => p.kind !== "partner");
  const always = listings.filter((p) => p.tier === "always");
  const sometimes = listings.filter((p) => p.tier === "sometimes");
  // Pending counts what must go out for every concert; "some concerts" sites are optional.
  const pending = count([...partners, ...always], "pending");
  const sometimesStarted = sometimes.filter((p) => stageOf(p) !== "pending").length;
  const unpublished = routine.filter((p) => stageOf(p) === "pending" || stageOf(p) === "sent").length;

  return (
    <details open={open} className="group/concert rounded-xl border border-border bg-surface md:rounded-lg">
      <summary className={cn(summaryClass, "gap-3 px-4 py-3 active:opacity-70")}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold text-fg md:text-base">{event.title}</p>
          <p className="truncate text-[13px] text-muted md:text-xs">
            {shortDate(event)}
            {event.venue ? ` · ${event.venue}` : ""}
          </p>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] md:text-xs">
            <Count stage="pending" n={pending} label="pending" />
            <Count stage="sent" n={count(routine, "sent")} label="sent" />
            <Count stage="published" n={count(routine, "published")} label="published" />
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-subtle transition-transform group-open/concert:rotate-90" aria-hidden />
      </summary>

      <div className="border-t border-border pb-1">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <CopyBrief text={listingBrief(event, platforms)} pending={unpublished} />
          {event.ticketUrl ? (
            <a href={event.ticketUrl} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-9 items-center gap-1 px-1 text-[13px] text-muted hover:text-fg md:text-xs">
              Tickets page
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>

        <Group title="Ticketing partners" icon={<Ticket className="size-3.5" aria-hidden />} platforms={partners} eventId={event.id} />
        <Group title="Listings, every concert" platforms={always} eventId={event.id} />
        {sometimes.length ? (
          <details className="group/some">
            <summary className={cn(summaryClass, "min-h-10 gap-1.5 px-4 text-xs font-medium uppercase tracking-wide text-subtle")}>
              <ChevronRight className="size-3.5 transition-transform group-open/some:rotate-90" aria-hidden />
              Listings, some concerts ({sometimes.length}
              {sometimesStarted ? `, ${sometimesStarted} started` : ""})
            </summary>
            <Rows platforms={sometimes} eventId={event.id} />
          </details>
        ) : null}

        <details className="group/edit">
          <summary className={cn(summaryClass, "min-h-11 gap-1.5 px-4 text-[13px] text-muted hover:text-fg md:min-h-10 md:text-xs")}>
            <Pencil className="size-3.5" aria-hidden />
            Concert details (what the forms ask for)
          </summary>
          <div className="px-4 pb-3 pt-1">
            <EventForm event={event} />
          </div>
        </details>
      </div>
    </details>
  );
}

function Count({ stage, n, label }: { stage: Stage; n: number; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", stage === "pending" && n > 0 ? "font-medium text-fg" : "text-muted")}>
      <span className={cn("size-2 rounded-full", STAGE_DOT[stage])} aria-hidden />
      {n} {label}
    </span>
  );
}

function Group({ title, icon, platforms, eventId }: { title: string; icon?: React.ReactNode; platforms: PlatformForEvent[]; eventId: string }) {
  if (!platforms.length) return null;
  const done = platforms.length - count(platforms, "pending");
  return (
    <section className="mb-2">
      <h3 className="flex min-h-9 items-center gap-1.5 px-4 text-xs font-medium uppercase tracking-wide text-subtle">
        {icon}
        {title}
        <span className="ml-auto tabular-nums normal-case">
          {done} of {platforms.length} done
        </span>
      </h3>
      <Rows platforms={platforms} eventId={eventId} />
    </section>
  );
}

/** The simple list: the site, how it is sent (email, form, account) and its status, changed in place. */
function Rows({ platforms, eventId }: { platforms: PlatformForEvent[]; eventId: string }) {
  return (
    <ul className="flex flex-col divide-y divide-border border-y border-border">
      {platforms.map((p) => {
        const status = statusOf(p);
        const s = p.submission;
        const tickets =
          p.kind === "partner" && s
            ? [s.ticketsOffered != null ? `${s.ticketsOffered} tickets` : null, s.memberPrice, s.ticketsTaken != null ? `${s.ticketsTaken} taken` : null]
                .filter(Boolean)
                .join(" · ")
            : "";
        return (
          <li key={p.id} className="flex min-h-14 items-center gap-2.5 py-1.5 pl-4 pr-3 md:min-h-11">
            <span className={cn("size-2.5 shrink-0 rounded-full", STAGE_DOT[STAGE_OF[status]])} aria-hidden />
            <Link href={`/promotion/p/${p.id}?event=${eventId}`} className="min-w-0 flex-1 active:opacity-60 md:hover:underline">
              <span className="block truncate text-[15px] text-fg md:text-sm">{p.name}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-subtle md:text-[11px]">
                <MethodTag method={p.method} />
                {p.cost === "paid" ? <span className="shrink-0 text-amber-700 dark:text-amber-300">· Paid</span> : null}
                {tickets ? <span className="truncate text-violet-700 dark:text-violet-300">· {tickets}</span> : null}
                {!tickets && s?.sentAt ? <span className="truncate">· {s.sentAt}</span> : null}
              </span>
            </Link>
            {s?.publicUrl ? (
              <a href={s.publicUrl} target="_blank" rel="noreferrer noopener" aria-label={`Public listing on ${p.name}`} className="shrink-0 p-1 text-emerald-600 dark:text-emerald-400">
                <ExternalLink className="size-4" aria-hidden />
              </a>
            ) : null}
            <StatusPicker key={`${p.id}-${status}`} eventId={eventId} platformId={p.id} status={status} />
          </li>
        );
      })}
    </ul>
  );
}
