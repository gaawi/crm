import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink, Mail, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { kindLabel, PLATFORM_TIERS } from "@/lib/listings/constants";
import { EmailTimeline } from "@/components/email-timeline";
import { env } from "@/lib/env";
import { getListingEvent, listListingEvents, listListingPlatforms, partnerHistory, platformsForEvent, type PlatformForEvent } from "@/lib/queries/listings";
import { getOwnAddresses } from "@/lib/queries/stats";
import { GroupTitle } from "../../../_components/ui";
import { cn } from "@/lib/utils";
import { hrefWith, param } from "../../../_lib/url";
import { StatusCell, SubmissionForm } from "../../forms";
import { PartnerSummary } from "../../parts";
import { PlatformSheetRow } from "../../sheets";
import { InsetGroup, MethodIcon, methodName, rowClass, splitByDate, stageOf, statusOf, ValueRow, ViewLink } from "../../stage";

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
  const p: PlatformForEvent = { submission: null, ...platform };
  const partner = p.kind === "partner";
  const [emails, self] = p.emailMatch.length ? await Promise.all([partnerHistory(p.emailMatch, 30), getOwnAddresses()]) : [[], new Set<string>()];
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
        {p.relationship ? (
          <InsetGroup title="In short">
            <li className="px-4 py-3">
              <PartnerSummary relationship={p.relationship} />
            </li>
          </InsetGroup>
        ) : null}

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
                <span className="flex-1 text-[17px] text-fg md:text-sm">Status</span>
                {stageOf(p) === "published" && p.submission?.publicUrl ? <ViewLink href={p.submission.publicUrl} name={p.name} /> : null}
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

        {emails.length ? (
          <section>
            <GroupTitle>Emails</GroupTitle>
            <EmailTimeline messages={emails} timezone={env.timezone} selfEmails={self} />
          </section>
        ) : null}

        <InsetGroup>
          <li>
            <PlatformSheetRow platform={p} tone="plain" icon={<Pencil className="size-4 text-muted" aria-hidden />} label="Edit this site" />
          </li>
        </InsetGroup>
      </div>
    </>
  );
}
