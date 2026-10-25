import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink, KeyRound, Mail, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, PageHeader } from "@/components/ui/layout";
import { listingBrief } from "@/lib/listings/brief";
import { methodLabel, SETTLED_STATUSES, SUBMISSION_STATUSES, statusLabel, type SubmissionStatus } from "@/lib/listings/constants";
import {
  getListingEvent,
  listListingEvents,
  platformsForEvent,
  type EventSummary,
  type PlatformForEvent,
} from "@/lib/queries/listings";
import { hostOf } from "@/lib/organizations/profile";
import { cn } from "@/lib/utils";
import { Segmented } from "../_components/segmented";
import { hrefWith, param } from "../_lib/url";
import { CopyBrief, EventForm, PlatformForm, StatusPicker, STATUS_STYLE, SubmissionForm } from "./forms";

export const metadata: Metadata = { title: "Listings" };

const FILTERS = ["open", "done", "all"] as const;
type Filter = (typeof FILTERS)[number];

function eventLabel(e: EventSummary): string {
  const date = new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, month: "short", day: "numeric" }).format(e.startsAt);
  return `${e.title} · ${date}`;
}

function whenLong(e: { startsAt: Date; timeZone: string }): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: e.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(e.startsAt);
}

/** The next concert still to come, else the latest one. */
function defaultEvent(events: EventSummary[]): EventSummary | undefined {
  const now = Date.now();
  const upcoming = events.filter((e) => e.startsAt.getTime() >= now - 6 * 3600_000).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return upcoming[0] ?? events[0];
}

/** Before the listings migration is applied, the tables do not exist yet. */
async function eventsOrMissing(): Promise<EventSummary[] | null> {
  try {
    return await listListingEvents();
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

export default async function ListingsPage({ searchParams }: PageProps<"/listings">) {
  const sp = await searchParams;
  const events = await eventsOrMissing();
  if (!events) {
    return (
      <>
        <PageHeader title="Listings" />
        <Notice tone="warning">
          The listings tables are not in the database yet: run supabase/migrations/20261025000000_listings.sql in the Supabase SQL editor, then reload.
        </Notice>
      </>
    );
  }
  const wanted = param(sp, "event", 40);
  const selected = events.find((e) => e.id === wanted) ?? defaultEvent(events);
  const filterParam = param(sp, "show");
  const filter: Filter = (FILTERS as readonly string[]).includes(filterParam) ? (filterParam as Filter) : "all";
  const [event, platforms] = await Promise.all([
    selected ? getListingEvent(selected.id) : Promise.resolve(null),
    platformsForEvent(selected?.id ?? null),
  ]);

  const statusOf = (p: PlatformForEvent): SubmissionStatus => p.submission?.status ?? "todo";
  const isDone = (p: PlatformForEvent) => SETTLED_STATUSES.includes(statusOf(p));
  const shown = platforms.filter((p) => (filter === "open" ? !isDone(p) && p.active : filter === "done" ? isDone(p) : true));
  const counts = Object.fromEntries(SUBMISSION_STATUSES.map((s) => [s.value, platforms.filter((p) => p.active && statusOf(p) === s.value).length])) as Record<
    SubmissionStatus,
    number
  >;
  const openCount = platforms.filter((p) => p.active && !isDone(p)).length;
  const brief = event ? listingBrief(event, platforms) : "";
  const href = (patch: Record<string, string>) => hrefWith("/listings", { event: selected?.id ?? "", show: filter === "all" ? "" : filter, ...patch });

  return (
    <>
      <PageHeader
        title="Listings"
        description="Where to post our concerts (calendars, magazines, newsletters) and, for each concert, where it went and what happened."
      />

      {events.length > 1 ? (
        <nav aria-label="Concerts" className="mb-3 flex flex-wrap gap-1.5 px-4 md:px-0">
          {events.map((e) => (
            <Link
              key={e.id}
              href={hrefWith("/listings", { event: e.id })}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-3 text-[13px] md:h-7 md:text-xs",
                e.id === selected?.id ? "border-fg bg-fg text-bg" : "border-border text-muted hover:text-fg",
              )}
            >
              {eventLabel(e)}
            </Link>
          ))}
        </nav>
      ) : null}

      {event ? (
        <section className="mb-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-fg md:text-base">{event.title}</h2>
              <p className="text-[13px] text-muted md:text-xs">
                {whenLong(event)}
                {event.venue ? ` · ${event.venue}` : ""}
                {event.prices ? ` · ${event.prices}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUBMISSION_STATUSES.filter((s) => counts[s.value]).map((s) => (
                  <Badge key={s.value} className={STATUS_STYLE[s.value]}>
                    {counts[s.value]} {s.label.toLowerCase()}
                  </Badge>
                ))}
              </div>
            </div>
            <CopyBrief text={brief} pending={openCount} />
          </div>
          <details className="group mt-3">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-[13px] text-muted hover:text-fg md:text-xs [&::-webkit-details-marker]:hidden">
              <Pencil className="size-3.5" aria-hidden />
              Concert details
            </summary>
            <div className="pt-2">
              <EventForm event={event} />
            </div>
          </details>
        </section>
      ) : (
        <EmptyState title="No concert yet">Add the concert you want to promote, then mark where it was sent.</EmptyState>
      )}

      {event ? (
        <Segmented
          label="Show"
          className="mb-3"
          fill={false}
          segments={[
            { href: href({ show: "" }), label: "All", active: filter === "all", count: platforms.length },
            { href: href({ show: "open" }), label: "To do", active: filter === "open", count: openCount },
            { href: href({ show: "done" }), label: "Done", active: filter === "done", count: platforms.length - platforms.filter((p) => !isDone(p)).length },
          ]}
        />
      ) : null}

      {event && shown.length ? (
        <ul className="flex flex-col gap-2">
          {shown.map((p) => (
            <PlatformRow key={p.id} platform={p} eventId={event.id} status={statusOf(p)} />
          ))}
        </ul>
      ) : event ? (
        <p className="px-4 py-6 text-center text-sm text-subtle md:px-0">{platforms.length ? "Nothing here." : "No platforms yet: add the first one below."}</p>
      ) : null}

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <details className="group rounded-xl border border-border bg-surface md:rounded-lg">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] text-fg active:opacity-60 md:min-h-10 md:text-sm [&::-webkit-details-marker]:hidden">
            <Plus className="size-4 text-muted" aria-hidden />
            Add a platform
          </summary>
          <div className="px-4 pb-4">
            <PlatformForm />
          </div>
        </details>
        <details className="group rounded-xl border border-border bg-surface md:rounded-lg">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-[15px] text-fg active:opacity-60 md:min-h-10 md:text-sm [&::-webkit-details-marker]:hidden">
            <Plus className="size-4 text-muted" aria-hidden />
            Add a concert
          </summary>
          <div className="px-4 pb-4">
            <EventForm />
          </div>
        </details>
      </div>
    </>
  );
}

function PlatformRow({ platform: p, eventId, status }: { platform: PlatformForEvent; eventId: string; status: SubmissionStatus }) {
  const s = p.submission;
  const target = p.submitUrl ?? p.website;
  return (
    <li className={cn("rounded-xl border border-border bg-surface md:rounded-lg", !p.active && "opacity-60")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {target ? (
              <a href={target} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-fg hover:underline">
                {p.name}
                <ExternalLink className="size-3.5 text-subtle" aria-hidden />
              </a>
            ) : (
              <span className="font-medium text-fg">{p.name}</span>
            )}
            <Badge>{methodLabel(p.method)}</Badge>
            <Badge
              className={
                p.cost === "free"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : p.cost === "paid"
                    ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : undefined
              }
              title={p.costNote ?? undefined}
            >
              {p.cost === "free" ? "Free" : p.cost === "paid" ? `Paid${p.costNote ? `: ${p.costNote}` : ""}` : "Cost ?"}
            </Badge>
            <Badge title={p.loginAccount ?? undefined}>
              <KeyRound className="size-3" aria-hidden />
              {p.loginRequired ? (p.loginAccount ? `Login: ${p.loginAccount}` : "Login") : "No login"}
            </Badge>
            {p.leadDays != null ? <Badge>{p.leadDays} days ahead</Badge> : null}
            {!p.active ? <Badge>Inactive</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-subtle md:text-xs">
            {p.email ? (
              <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-fg">
                <Mail className="size-3" aria-hidden />
                {p.email}
              </a>
            ) : null}
            {p.submitUrl && p.website && hostOf(p.website) !== hostOf(p.submitUrl) ? <span>{hostOf(p.website)}</span> : null}
            {p.audience ? <span>{p.audience}</span> : null}
          </div>
          {p.notes ? <p className="mt-1 text-[13px] text-muted md:text-xs">{p.notes}</p> : null}
          {s && (s.sentAt || s.sentBy || s.confirmationUrl || s.publicUrl || s.notes) ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-[13px] text-muted md:text-xs">
              {s.sentAt ? <span>{statusLabel(status)} {s.sentAt}</span> : null}
              {s.sentBy ? <span>by {s.sentBy}</span> : null}
              {s.confirmationUrl ? (
                <a href={s.confirmationUrl} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">
                  Confirmation
                </a>
              ) : null}
              {s.publicUrl ? (
                <a href={s.publicUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">
                  Public listing
                </a>
              ) : null}
              {s.notes ? <span className="basis-full">{s.notes}</span> : null}
            </div>
          ) : null}
        </div>
        <StatusPicker key={`${p.id}-${status}`} eventId={eventId} platformId={p.id} status={status} />
      </div>
      <details className="group border-t border-border">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 px-4 text-[13px] text-muted hover:text-fg md:min-h-8 md:text-xs [&::-webkit-details-marker]:hidden">
          <Pencil className="size-3" aria-hidden />
          Details
        </summary>
        <div className="grid gap-5 px-4 pb-4 pt-1 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">This concert</h3>
            <SubmissionForm eventId={eventId} platformId={p.id} submission={s} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">The platform</h3>
            {p.instructions ? <p className="mb-3 whitespace-pre-line text-[13px] text-muted md:text-xs">{p.instructions}</p> : null}
            <PlatformForm platform={p} />
          </div>
        </div>
      </details>
    </li>
  );
}
