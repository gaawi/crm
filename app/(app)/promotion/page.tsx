import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { Notice, PageHeader } from "@/components/ui/layout";
import { listListingEvents, listListingPlatforms, platformsForEvent, type EventSummary } from "@/lib/queries/listings";
import { param } from "../_lib/url";
import { EventForm, PlatformForm } from "./forms";
import { concertGroups, CountsLine, DateTile, InsetGroup, LinkRow, MethodIcon, methodName, ProgressBar, splitByDate } from "./stage";

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

const addClass =
  "flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 text-[17px] text-blue-600 active:bg-surface-2 md:min-h-11 md:text-sm dark:text-blue-400 [&::-webkit-details-marker]:hidden";

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
  const [counts, platforms] = await Promise.all([
    Promise.all(all.map(async (e) => [e.id, concertGroups(await platformsForEvent(e.id)).counts] as const)).then((rows) => new Map(rows)),
    listListingPlatforms(),
  ]);
  const skipped = platforms.filter((p) => p.tier === "skip");
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
            <details className="group">
              <summary className={addClass}>
                <Plus className="size-5" aria-hidden />
                Add a concert
              </summary>
              <div className="border-t border-border px-4 py-4">
                <EventForm />
              </div>
            </details>
          </li>
        </InsetGroup>

        {past.length ? <InsetGroup title="Past concerts">{past.map(row)}</InsetGroup> : null}

        <InsetGroup title="Sites" footer="Partners and listing sites live here; each concert shows the ones it goes to.">
          <li>
            <details className="group">
              <summary className={addClass}>
                <Plus className="size-5" aria-hidden />
                Add a partner or listing site
              </summary>
              <div className="border-t border-border px-4 py-4">
                <PlatformForm />
              </div>
            </details>
          </li>
          {skipped.length ? (
            <li>
              <details className="group/skip">
                <summary className={addClass.replace("text-blue-600", "text-fg").replace("dark:text-blue-400", "")}>
                  <span className="flex-1">Not worth it</span>
                  <span className="text-muted">{skipped.length}</span>
                </summary>
                <ul className="border-t border-border [&>li+li]:border-t [&>li+li]:border-border">
                  {skipped.map((p) => (
                    <LinkRow key={p.id} href={`/promotion/p/${p.id}`}>
                      <MethodIcon method={p.method} />
                      <span className="min-w-0 flex-1 truncate text-[17px] text-muted md:text-sm">{p.name}</span>
                      <span className="text-[15px] text-subtle md:text-xs">{methodName(p.method)}</span>
                    </LinkRow>
                  ))}
                </ul>
              </details>
            </li>
          ) : null}
        </InsetGroup>
      </div>
    </>
  );
}
