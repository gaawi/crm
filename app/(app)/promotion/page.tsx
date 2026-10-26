import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Plus, Ticket } from "lucide-react";
import { Notice, PageHeader } from "@/components/ui/layout";
import { upcomingGuestListEvents } from "@/lib/queries/guests";
import { listListingEvents, listListingPlatforms, platformsForEvent, type EventSummary } from "@/lib/queries/listings";
import { param } from "../_lib/url";
import { EventSheetRow, PlatformSheetRow } from "./sheets";
import { concertGroups, CountsLine, DateTile, InsetGroup, LinkRow, ProgressBar, splitByDate } from "./stage";

export const metadata: Metadata = { title: "Promotion" };

/** Before the promotion migration is applied, the tables do not exist yet. */
async function eventsOrMissing(): Promise<EventSummary[] | null> {
  try {
    return await listListingEvents();
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

/** The concerts being promoted; each one opens its checklist. */
export default async function PromotionPage({ searchParams }: PageProps<"/promotion">) {
  const sp = await searchParams;
  // Old links pointed at /promotion?event=…
  const legacy = param(sp, "event", 40);
  if (legacy) redirect(`/promotion/c/${legacy}`);

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
  const [counts, platforms, guestLists] = await Promise.all([
    Promise.all(all.map(async (e) => [e.id, concertGroups(await platformsForEvent(e.id)).counts] as const)).then((rows) => new Map(rows)),
    listListingPlatforms(),
    upcomingGuestListEvents(),
  ]);
  const skipped = platforms.filter((p) => p.tier === "skip").length;
  const row = (e: EventSummary) => {
    const c = counts.get(e.id)!;
    return (
      <LinkRow key={e.id} href={`/promotion/c/${e.id}`} className="py-3">
        <DateTile startsAt={e.startsAt} timeZone={e.timeZone} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[17px] font-semibold leading-tight text-fg md:text-sm">{e.title}</span>
          <CountsLine counts={c} />
          <ProgressBar counts={c} className="mt-0.5" />
        </span>
      </LinkRow>
    );
  };

  return (
    <>
      <PageHeader title="Promotion" />
      <div className="flex flex-col gap-7 md:max-w-2xl">
        <InsetGroup title="Upcoming concerts">
          {upcoming.map(row)}
          <li>
            <EventSheetRow label="Add a concert" icon={<Plus className="size-5" aria-hidden />} />
          </li>
        </InsetGroup>

        {past.length ? <InsetGroup title="Past concerts">{past.map(row)}</InsetGroup> : null}

        {guestLists.length ? (
          <InsetGroup title="Guest lists" footer="Add people from their email in Mail with one tap; check them in at the door here.">
            {guestLists.map((e) => (
              <LinkRow key={e.id} href={`/promotion/c/${e.id}/guests`}>
                <Ticket className="size-5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] text-fg md:text-sm">{e.title}</span>
                  <span className="block truncate text-[13px] text-subtle md:text-xs">
                    {new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, weekday: "short", month: "short", day: "numeric" }).format(e.startsAt)}
                    {e.venue ? ` · ${e.venue}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[15px] tabular-nums text-muted md:text-xs">{e.guests ? `${e.guests} · ${e.tickets} tix` : "Empty"}</span>
              </LinkRow>
            ))}
          </InsetGroup>
        ) : null}

        <InsetGroup title="Sites" footer="Partners and listing sites live here; each concert shows the ones it goes to.">
          <li>
            <PlatformSheetRow label="Add a partner or listing site" icon={<Plus className="size-5" aria-hidden />} />
          </li>
          {skipped ? (
            <LinkRow href="/promotion/skipped">
              <span className="flex-1 text-[17px] text-fg md:text-sm">Not worth it</span>
              <span className="text-[17px] text-muted md:text-sm">{skipped}</span>
            </LinkRow>
          ) : null}
        </InsetGroup>
      </div>
    </>
  );
}
