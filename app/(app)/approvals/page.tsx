import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Hourglass } from "lucide-react";
import { DraftCard } from "@/components/draft-card";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/layout";
import { heldBackCounts, listCampaigns, listCampaignSummaries } from "@/lib/campaigns/campaigns";
import { env } from "@/lib/env";
import { listDrafts, recoverStaleDrafts } from "@/lib/queries/drafts";
import { getSettings } from "@/lib/queries/settings";
import { CampaignCard } from "./campaign-card";
import { PrepareDraftsButton } from "./prepare-button";

export const metadata: Metadata = { title: "Approvals" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function ApprovalsPage() {
  const timezone = env.timezone;
  await recoverStaleDrafts();
  const now = new Date();
  // Campaign emails are listed inside their campaign, standalone emails below.
  const [campaigns, open, recent, autopilot, finished, waitingVersion] = await Promise.all([
    listCampaignSummaries({}, now),
    listDrafts(),
    listDrafts({ statuses: ["sent"], limit: 10, campaign: "include" }),
    getSettings("autopilot"),
    listCampaigns({ statuses: ["done", "cancelled"], limit: 10 }),
    listDrafts({ statuses: ["changes_requested"], campaign: "include", limit: 50 }),
  ]);
  // Finished campaigns with nothing left for the owner: a way back to them (what was sent, when).
  const past = finished.filter((c) => !campaigns.some((x) => x.id === c.id)).slice(0, 5);
  const held = await heldBackCounts(campaigns.map((c) => c.id));
  // Waiting for the owner's approval: prepared, or cancelled / done with emails left to approve.
  const waitingCampaigns = campaigns.filter((c) => c.status !== "running" && c.status !== "paused" && c.remaining > 0).length;

  const waiting = [waitingCampaigns ? plural(waitingCampaigns, "campaign") : "", open.length ? plural(open.length, "email") : ""].filter(Boolean);
  const description = waiting.length
    ? `${waiting.join(" and ")} prepared for you, waiting for your approval. Nothing is sent until you approve.`
    : campaigns.length
      ? "Campaigns you approved are sent a few at a time. Nothing else is waiting for you."
      : "Emails prepared for you land here. Nothing is sent until you approve.";

  return (
    <>
      <PageHeader title="Approvals" description={description} actions={env.claudeEnabled ? <PrepareDraftsButton /> : null} />

      {campaigns.length ? (
        <section className="mb-8" aria-label="Campaigns">
          <SectionTitle count={campaigns.length}>Campaigns</SectionTitle>
          <div className="flex flex-col gap-3">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} held={held[c.id] ?? 0} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label="Emails">
        {campaigns.length && open.length ? <SectionTitle count={open.length}>Emails</SectionTitle> : null}
        <div className="flex flex-col gap-4">
          {open.length ? (
            open.map((draft) => <DraftCard key={draft.id} draft={draft} timezone={timezone} compact />)
          ) : campaigns.length ? null : (
            <EmptyState title="Nothing to approve">
              {!env.claudeEnabled
                ? "Nothing is waiting for your approval."
                : autopilot.enabled
                  ? "The autopilot prepares replies and follow-ups every day. Tap “Prepare drafts” to run it now."
                  : "Tap “Prepare drafts” and Claude will write replies and follow-ups for the people waiting on you. You can turn on the daily autopilot in Settings."}
            </EmptyState>
          )}
        </div>
      </section>

      {waitingVersion.length ? (
        <section className="mt-10" aria-label="Waiting for new version">
          <SectionTitle count={waitingVersion.length}>Waiting for new version</SectionTitle>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
            {waitingVersion.map((d) => (
              <li key={d.id} className="flex min-h-[52px] items-start gap-3 px-4 py-2.5 text-sm">
                <Hourglass className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <span className="font-medium">{d.contact?.displayName ?? d.to.join(", ")}</span>
                    <span className="text-muted"> · {d.subject}</span>
                  </span>
                  {d.revisionRequest ? <span className="block text-[13px] text-muted md:text-xs">You asked: “{d.revisionRequest}”</span> : null}
                </span>
                <span className="shrink-0 text-xs text-subtle">Waiting for new version</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {past.length ? (
        <section className="mt-10" aria-label="Past campaigns">
          <SectionTitle>Past campaigns</SectionTitle>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
            {past.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/approvals/campaigns/${c.id}`}
                  className="flex min-h-[52px] items-center gap-3 px-4 py-2 text-sm active:bg-surface-2 md:min-h-0 md:py-2.5 md:hover:bg-surface-2/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-[13px] text-muted md:text-xs">
                      {plural(c.counts.sent, "email")} sent{c.status === "cancelled" ? " · cancelled" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-subtle">
                    {c.finishedAt ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(new Date(c.finishedAt)) : ""}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length ? (
        <section className="mt-10">
          <SectionTitle>Recently sent</SectionTitle>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
            {recent.map((d) => (
              <li key={d.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{d.contact?.displayName ?? d.to.join(", ")}</span>
                  <span className="text-muted"> · {d.subject}</span>
                </span>
                <span className="shrink-0 text-xs text-subtle">
                  {d.sentAt ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(d.sentAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
