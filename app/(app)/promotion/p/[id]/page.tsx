import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink, KeyRound, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/layout";
import { kindLabel, PLATFORM_TIERS } from "@/lib/listings/constants";
import { getListingEvent, listListingEvents, listListingPlatforms, partnerThreads, platformsForEvent } from "@/lib/queries/listings";
import { cn } from "@/lib/utils";
import { hrefWith, param } from "../../../_lib/url";
import { PlatformForm, StatusPicker, SubmissionForm } from "../../forms";
import { PartnerEmails, Relationship } from "../../parts";
import { MethodTag, splitByDate, STAGE_DOT, stageOf, statusOf } from "../../stage";

export const metadata: Metadata = { title: "Promotion" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One partner or listing site: how to submit there, this concert's submission, and (for partners) the relationship and emails. */
export default async function PromotionPlatformPage({ params, searchParams }: PageProps<"/promotion/p/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const events = await listListingEvents();
  const { upcoming, past } = splitByDate(events);
  const wanted = param(sp, "event", 40);
  const selected = events.find((e) => e.id === wanted) ?? upcoming[0] ?? events[0];
  const [platform, event] = await Promise.all([
    selected ? platformsForEvent(selected.id).then((all) => all.find((p) => p.id === id)) : listListingPlatforms().then((all) => all.find((p) => p.id === id)),
    selected ? getListingEvent(selected.id) : Promise.resolve(null),
  ]);
  if (!platform) notFound();
  const p = { submission: null, ...platform };
  const partner = p.kind === "partner";
  const threads = partner && p.emailMatch.length ? await partnerThreads(p.emailMatch, 25) : [];
  const target = p.submitUrl ?? p.website;
  const status = statusOf(p);
  const tier = PLATFORM_TIERS.find((t) => t.value === p.tier)?.label;

  return (
    <>
      <PageHeader title={p.name} description={[kindLabel(p.kind), tier].filter(Boolean).join(" · ")} back={{ href: hrefWith("/promotion", { event: selected?.id ?? "" }), label: "Promotion" }} />

      {event ? (
        <section className="mb-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg">
          {events.length > 1 ? (
            <nav aria-label="Concerts" className="mb-3 flex flex-wrap gap-1.5">
              {[...upcoming, ...past].map((e) => (
                <Link
                  key={e.id}
                  href={hrefWith(`/promotion/p/${id}`, { event: e.id })}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3 text-[13px] md:h-7 md:text-xs",
                    e.id === event.id ? "border-fg bg-fg text-bg" : "border-border text-muted hover:text-fg",
                  )}
                >
                  {e.title}
                </Link>
              ))}
            </nav>
          ) : null}
          <div className="mb-3 flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-full", STAGE_DOT[stageOf(p)])} aria-hidden />
            <h2 className="min-w-0 flex-1 truncate font-medium text-fg">{event.title}</h2>
            <StatusPicker key={`${p.id}-${event.id}-${status}`} eventId={event.id} platformId={p.id} status={status} />
          </div>
          <SubmissionForm key={event.id} eventId={event.id} platformId={p.id} submission={p.submission} partner={partner} />
        </section>
      ) : null}

      <section className="mb-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">How to send it</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>
            <MethodTag method={p.method} />
          </Badge>
          <Badge
            className={
              p.cost === "free"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : p.cost === "paid"
                  ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  : undefined
            }
          >
            {p.cost === "free" ? "Free" : p.cost === "paid" ? "Paid" : "Cost unknown"}
          </Badge>
          <Badge className="max-w-full">
            <KeyRound className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{p.loginRequired ? (p.loginAccount ? `Login: ${p.loginAccount}` : "Login needed") : "No login"}</span>
          </Badge>
          {p.leadDays != null ? <Badge>{p.leadDays} days ahead</Badge> : null}
        </div>
        <div className="mt-3 flex flex-col gap-1.5 text-[15px] md:text-sm">
          {target ? (
            <a href={target} target="_blank" rel="noreferrer noopener" className="inline-flex min-w-0 items-center gap-1.5 text-fg underline-offset-2 hover:underline">
              <ExternalLink className="size-4 shrink-0 text-subtle" aria-hidden />
              <span className="truncate">{p.submitUrl ? "Submission page" : "Website"}</span>
            </a>
          ) : null}
          {p.email ? (
            <a href={`mailto:${p.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-fg underline-offset-2 hover:underline">
              <Mail className="size-4 shrink-0 text-subtle" aria-hidden />
              <span className="truncate">{p.email}</span>
            </a>
          ) : null}
        </div>
        <dl className="mt-3 flex flex-col gap-2 text-[14px] text-muted md:text-[13px]">
          {p.costNote ? <Fact term="Cost">{p.costNote}</Fact> : null}
          {p.fields ? <Fact term="They ask for">{p.fields}</Fact> : null}
          {p.instructions ? <Fact term="Instructions">{p.instructions}</Fact> : null}
          {p.audience ? <Fact term="Audience">{p.audience}</Fact> : null}
          {p.notes ? <Fact term="Notes">{p.notes}</Fact> : null}
        </dl>
      </section>

      {p.relationship ? (
        <section className="mb-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg">
          <Relationship relationship={p.relationship} />
        </section>
      ) : null}
      {threads.length ? (
        <section className="mb-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg">
          <PartnerEmails threads={threads} />
        </section>
      ) : null}

      <details className="group rounded-xl border border-border bg-surface md:rounded-lg">
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 text-[15px] text-fg active:opacity-60 md:min-h-10 md:text-sm [&::-webkit-details-marker]:hidden">
          Edit this site
        </summary>
        <div className="px-4 pb-4">
          <PlatformForm platform={p} />
        </div>
      </details>
    </>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-fg">{term}</dt>
      <dd className="whitespace-pre-line">{children}</dd>
    </div>
  );
}
