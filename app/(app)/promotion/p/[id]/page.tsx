import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight, ExternalLink, Mail, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { kindLabel, PLATFORM_TIERS } from "@/lib/listings/constants";
import { getListingEvent, listListingEvents, listListingPlatforms, partnerThreads, platformsForEvent } from "@/lib/queries/listings";
import { cn } from "@/lib/utils";
import { hrefWith, param } from "../../../_lib/url";
import { PlatformForm, StatusCell, SubmissionForm } from "../../forms";
import { PartnerEmails, Relationship } from "../../parts";
import { InsetGroup, MethodIcon, methodName, rowClass, splitByDate, statusOf, ValueRow } from "../../stage";

export const metadata: Metadata = { title: "Promotion" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One partner or listing site: this concert's submission, how to send there, and (for partners) the relationship and emails. */
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
  const tier = PLATFORM_TIERS.find((t) => t.value === p.tier)?.label;
  const back = event && wanted ? { href: `/promotion/c/${event.id}`, label: event.title } : { href: "/promotion", label: "Promotion" };
  const target = p.submitUrl ?? p.website;
  const texts = [
    ["They ask for", p.fields],
    ["Instructions", p.instructions],
    ["Cost", p.costNote],
    ["Audience", p.audience],
    ["Notes", p.notes],
  ].filter((t): t is [string, string] => Boolean(t[1]));
  const linkRow = cn(rowClass, "text-[17px] text-blue-600 active:bg-surface-2 md:text-sm dark:text-blue-400");

  return (
    <>
      <PageHeader title={p.name} description={[kindLabel(p.kind), tier].filter(Boolean).join(" · ")} back={back} />
      <div className="flex flex-col gap-7 md:max-w-2xl">
        {event ? (
          <section>
            {events.length > 1 ? (
              <nav aria-label="Concerts" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
                {[...upcoming, ...past].map((e) => (
                  <Link
                    key={e.id}
                    href={hrefWith(`/promotion/p/${id}`, { event: e.id })}
                    replace
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center rounded-full px-4 text-[15px] md:h-7 md:px-3 md:text-xs",
                      e.id === event.id ? "bg-fg text-bg" : "bg-surface-2 text-muted active:opacity-60",
                    )}
                  >
                    {e.title}
                  </Link>
                ))}
              </nav>
            ) : null}
            <InsetGroup title={event.title}>
              <li className={cn(rowClass, "justify-between")}>
                <span className="text-[17px] text-fg md:text-sm">Status</span>
                <StatusCell key={`${p.id}-${event.id}-${statusOf(p)}`} eventId={event.id} platformId={p.id} status={statusOf(p)} />
              </li>
            </InsetGroup>
            <div className="mt-7">
              <SubmissionForm key={event.id} eventId={event.id} platformId={p.id} submission={p.submission} partner={partner} />
            </div>
          </section>
        ) : null}

        <InsetGroup title="How to send it">
          <li className={cn(rowClass, "justify-between")}>
            <span className="text-[17px] text-fg md:text-sm">Method</span>
            <span className="flex items-center gap-2 text-[17px] text-muted md:text-sm">
              {methodName(p.method)}
              <MethodIcon method={p.method} />
            </span>
          </li>
          <ValueRow label="Cost">{p.cost === "free" ? "Free" : p.cost === "paid" ? "Paid" : "Unknown"}</ValueRow>
          <ValueRow label="Login">{p.loginRequired ? (p.loginAccount ?? "Needed") : "Not needed"}</ValueRow>
          {p.leadDays != null ? <ValueRow label="Notice">{p.leadDays} days ahead</ValueRow> : null}
          {target ? (
            <li>
              <a href={target} target="_blank" rel="noreferrer noopener" className={linkRow}>
                <ExternalLink className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{p.submitUrl ? "Open the submission page" : "Open the website"}</span>
              </a>
            </li>
          ) : null}
          {p.email ? (
            <li>
              <a href={`mailto:${p.email}`} className={linkRow}>
                <Mail className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{p.email}</span>
              </a>
            </li>
          ) : null}
        </InsetGroup>

        {texts.length ? (
          <InsetGroup>
            {texts.map(([label, text]) => (
              <li key={label} className="px-4 py-3">
                <p className="text-[13px] uppercase tracking-wide text-subtle md:text-xs">{label}</p>
                <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-fg md:text-sm">{text}</p>
              </li>
            ))}
          </InsetGroup>
        ) : null}

        {p.relationship ? (
          <InsetGroup>
            <li className="px-4 py-4">
              <Relationship relationship={p.relationship} />
            </li>
          </InsetGroup>
        ) : null}
        {threads.length ? (
          <InsetGroup>
            <li className="px-4 py-4">
              <PartnerEmails threads={threads} />
            </li>
          </InsetGroup>
        ) : null}

        <InsetGroup>
          <li>
            <details className="group">
              <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 active:bg-surface-2 md:min-h-11 [&::-webkit-details-marker]:hidden">
                <Pencil className="size-4 text-muted" aria-hidden />
                <span className="flex-1 text-[17px] text-fg md:text-sm">Edit this site</span>
                <ChevronRight className="size-5 text-subtle/70 transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              <div className="border-t border-border px-4 py-4">
                <PlatformForm platform={p} />
              </div>
            </details>
          </li>
        </InsetGroup>
      </div>
    </>
  );
}
