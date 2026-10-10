import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { AccountBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { getCampaignSummary } from "@/lib/campaigns/campaigns";
import { campaignSize, countParts, isHeldBack, timeZoneCity } from "@/lib/campaigns/format";
import { formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { listDrafts, recoverStaleDrafts } from "@/lib/queries/drafts";
import type { EmailDraft } from "@/lib/types";
import { Segmented } from "../../../_components/segmented";
import { GroupTitle } from "../../../_components/ui";
import { oneOf } from "../../../_lib/url";
import { CampaignStatusBadge, CountList } from "../../campaign-ui";
import { CampaignEmails } from "./campaign-emails";
import { CampaignPanel } from "./campaign-panel";

export const metadata: Metadata = { title: "Campaign" };

type Tab = "attention" | "send" | "sent" | "discarded";

const TABS: { value: Tab; label: string }[] = [
  { value: "attention", label: "Needs you" },
  { value: "send", label: "To send" },
  { value: "sent", label: "Sent" },
  { value: "discarded", label: "Discarded" },
];

function tabOf(draft: EmailDraft): Tab {
  if (draft.status === "failed" || isHeldBack(draft)) return "attention";
  if (draft.status === "sent") return "sent";
  if (draft.status === "discarded") return "discarded";
  return "send";
}

/** Time zones offered for the sending hours: Madrid, New York, the owner's own and the campaign's. */
function timeZoneOptions(current: string, owner: string): { value: string; label: string }[] {
  const zones = [...new Set([current, "Europe/Madrid", "America/New_York", owner])];
  return zones.map((tz) => ({ value: tz, label: `${timeZoneCity(tz)} (${tz})${tz === owner ? " · your time zone" : ""}` }));
}

/**
 * One campaign: the plan and its approval ("Approve N emails and start
 * sending"), progress while it sends, and its emails — what needs you (held
 * back, failed), what is still to send, what went out.
 */
export default async function CampaignPage({ params, searchParams }: PageProps<"/approvals/campaigns/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  await recoverStaleDrafts();
  const now = new Date();
  const campaign = await getCampaignSummary(id, now);
  if (!campaign) notFound();
  const timezone = env.timezone;
  const drafts = await listDrafts({ campaign: campaign.id });

  const groups: Record<Tab, EmailDraft[]> = { attention: [], send: [], sent: [], discarded: [] };
  for (const d of drafts) groups[tabOf(d)].push(d);
  const held = drafts.filter(isHeldBack).length;

  const requested = oneOf(sp, "show", TABS.map((t) => t.value));
  const tab: Tab = requested || (TABS.map((t) => t.value).find((t) => groups[t].length) ?? "send");
  const visibleTabs = TABS.filter((t) => t.value === tab || t.value === "send" || groups[t.value].length);
  const shown = groups[tab];

  return (
    <>
      <AutoRefresh active={campaign.status === "running"} seconds={60} />
      <PageHeader
        back={{ href: "/approvals", label: "Approvals" }}
        // Campaign names are long ("<sheet> · <template> · <date>"): a smaller large title on phones.
        title={campaign.name.length > 32 ? <span className="text-[22px] md:text-xl">{campaign.name}</span> : campaign.name}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted md:text-xs">
          <CampaignStatusBadge status={campaign.status} />
          {campaign.projectId && campaign.projectName ? (
            <Link href={`/campaigns/${campaign.projectId}`} className="hover:text-fg hover:underline">
              {campaign.projectName}
            </Link>
          ) : null}
          <span className="flex items-center gap-1">
            from <AccountBadge email={campaign.accountEmail} />
          </span>
          <span>
            Prepared {formatDateTime(new Date(campaign.createdAt), timezone)}
            {campaign.startedAt ? ` · approved ${formatDateTime(new Date(campaign.startedAt), timezone)}` : ""}
          </span>
        </div>
        <CountList parts={countParts(campaign.counts, held, { discarded: true })} />
      </PageHeader>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start [&>*]:min-w-0">
        <div className="lg:sticky lg:top-6">
          <CampaignPanel
            campaign={campaign}
            held={held}
            ownerTimezone={timezone}
            now={now.toISOString()}
            timezones={timeZoneOptions(campaign.timezone, timezone)}
          />
        </div>

        <section aria-label="Emails in this campaign">
          <GroupTitle>
            Emails · {campaignSize(campaign.counts)}
          </GroupTitle>
          {visibleTabs.length > 1 ? (
            <Segmented
              label="Show"
              className="mb-3"
              equal={false}
              segments={visibleTabs.map((t) => ({
                href: `/approvals/campaigns/${campaign.id}?show=${t.value}`,
                label: t.label,
                active: t.value === tab,
                count: groups[t.value].length,
              }))}
            />
          ) : null}
          {tab === "attention" && shown.length ? (
            <p className="mb-3 px-4 text-[13px] text-muted md:px-0 md:text-xs">
              Held back: the person got in touch after the email was prepared, so it was not sent. Check the conversation, then queue it again, edit, send it now or discard it.
            </p>
          ) : null}
          {shown.length ? (
            <CampaignEmails key={tab} drafts={shown} timezone={timezone} defaultOpen={tab === "attention"} />
          ) : (
            <EmptyState title={tab === "send" ? "Nothing left to send" : "No emails here"}>
              {tab === "send" ? "Every email of this campaign was sent, set aside or discarded." : null}
            </EmptyState>
          )}
        </section>
      </div>
    </>
  );
}
