import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { ProjectDot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import type { BookingSheet, SheetStageCounts } from "@/lib/booking/types";
import { labelKindFor, stageLabel } from "@/lib/constants";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { advanceSheetStages, listSheets } from "@/lib/queries/booking";
import { listCampaignSummaries } from "@/lib/campaigns/campaigns";
import { campaignSize, roundUpToTick, whenPhrase } from "@/lib/campaigns/format";
import type { CampaignSummary } from "@/lib/campaigns/types";
import { campaignResults, resultsLine, type CampaignResults } from "@/lib/campaigns/results";
import { CampaignStatusBadge, ProgressBar } from "../approvals/campaign-ui";
import type { OpportunityStage } from "@/lib/types";
import { ActionForm, FormSubmit } from "../_components/action-form";
import { FormActions, GroupTitle, HeaderAddButton } from "../_components/ui";
import { param } from "../_lib/url";
import { createSheetAction } from "./actions";

export const metadata: Metadata = { title: "Campaigns" };

/** Stage counts in the sheet's order, without the empty ones ("3 to contact · 2 contacted · 1 confirmed"). */
const STAGE_PARTS: { key: keyof SheetStageCounts; stage: OpportunityStage }[] = [
  { key: "toContact", stage: "lead" },
  { key: "contacted", stage: "contacted" },
  { key: "replied", stage: "replied" },
  { key: "proposal", stage: "proposal" },
  { key: "inConversation", stage: "negotiation" },
  { key: "confirmed", stage: "won" },
  { key: "declined", stage: "lost" },
];

const STAGE_BAR: Record<OpportunityStage, string> = {
  lead: "bg-zinc-300 dark:bg-zinc-600",
  contacted: "bg-blue-500",
  replied: "bg-teal-500",
  proposal: "bg-violet-500",
  negotiation: "bg-amber-500",
  won: "bg-emerald-500",
  lost: "bg-zinc-400/60 dark:bg-zinc-500/60",
};

/** Booking names while every row is a booking (or shares one goal), generic ones when the sheet mixes goals. */
function stageSummary(sheet: BookingSheet): string {
  const kind = labelKindFor(sheet.kinds);
  return STAGE_PARTS.filter((p) => sheet.counts[p.key] > 0)
    .map((p) => `${sheet.counts[p.key]} ${stageLabel(p.stage, kind).toLowerCase()}`)
    .join(" · ");
}

/** Thin bar: how the campaign's contacts split across the statuses. */
function StageBar({ sheet }: { sheet: BookingSheet }) {
  return (
    <div className="mt-2 flex h-1.5 max-w-sm overflow-hidden rounded-full bg-surface-2" aria-hidden>
      {STAGE_PARTS.map((p) =>
        sheet.counts[p.key] ? <span key={p.key} className={STAGE_BAR[p.stage]} style={{ width: `${(sheet.counts[p.key] / sheet.rows) * 100}%` }} /> : null,
      )}
    </div>
  );
}

/** One mass mailing: where it stands (sent of total, next send or why it is paused). Opens its page. */
function MailingRow({ c, now, results }: { c: CampaignSummary; now: Date; results?: CampaignResults }) {
  const outcome = resultsLine(results);
  const size = campaignSize(c.counts);
  const line =
    c.status === "draft"
      ? `${c.counts.proposed + c.counts.failed} emails waiting for your approval`
      : c.status === "running"
        ? `${c.counts.sent} of ${size} sent${c.nextSendAt ? ` · next ${whenPhrase(roundUpToTick(new Date(c.nextSendAt)), c.timezone, now)}` : ""}${c.sentToday ? ` · ${c.sentToday} today` : ""}`
        : c.status === "paused"
          ? `${c.counts.sent} of ${size} sent · paused`
          : `${c.counts.sent} of ${size} sent`;
  return (
    <li>
      <Link href={`/approvals/mailings/${c.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2 md:hover:bg-surface-2/60">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-medium md:text-sm">{c.name}</span>
            <CampaignStatusBadge status={c.status} className="shrink-0" />
          </div>
          {c.status !== "draft" ? <ProgressBar sent={c.counts.sent} held={0} failed={c.counts.failed} total={size} className="mt-2 max-w-sm" /> : null}
          <p className="mt-1 text-[13px] text-muted md:text-xs">{line}</p>
          {outcome ? <p className="mt-0.5 text-[13px] font-medium text-emerald-700 md:text-xs dark:text-emerald-400">{outcome}</p> : null}
          {c.error && c.status === "paused" ? <p className="mt-0.5 text-[13px] text-warning md:text-xs">{c.error}</p> : null}
        </div>
        <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
      </Link>
    </li>
  );
}

export default async function CampaignsPage({ searchParams }: PageProps<"/campaigns">) {
  const sp = await searchParams;
  const creating = param(sp, "new") === "1";
  await advanceSheetStages();
  const now = new Date();
  const [sheets, mailings] = await Promise.all([listSheets(todayIn(env.timezone)), listCampaignSummaries({}, now)]);
  const results = await campaignResults(mailings.map((m) => m.id));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Bookings, partners, press, funding: the organizations and people you reach out to, where each one stands and what comes next."
        actions={<HeaderAddButton href="/campaigns?new=1" label="New campaign" />}
      />

      {creating ? (
        <section className="mb-8" aria-label="New campaign">
          <GroupTitle>New campaign</GroupTitle>
          <ActionForm action={createSheetAction} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg">
            <div className="grid gap-3 md:grid-cols-[1fr_10rem_10rem]">
              <Field label="Name">
                <Input name="name" required autoFocus placeholder="Gira España 2027 · CreArtBox" />
              </Field>
              <Field label="Currency">
                <Select name="currency" defaultValue="USD">
                  <option value="USD">USD $</option>
                  <option value="EUR">EUR €</option>
                  <option value="GBP">GBP £</option>
                </Select>
              </Field>
              <Field label="Phone prefix" hint="Added to numbers typed without one.">
                <Input name="phonePrefix" inputMode="tel" autoComplete="off" placeholder="+34 or +1" maxLength={8} />
              </Field>
            </div>
            <FormActions>
              <FormSubmit pendingLabel="Creating…">Create campaign</FormSubmit>
              <ButtonLink href="/campaigns" variant="ghost">
                Cancel
              </ButtonLink>
            </FormActions>
          </ActionForm>
        </section>
      ) : null}

      {mailings.length ? (
        <section className="mb-8" aria-label="Mass mailings">
          <GroupTitle
            actions={
              <Link href="/approvals" className="text-[13px] text-muted active:opacity-60 md:text-xs md:hover:text-fg">
                All, and past ones
              </Link>
            }
          >
            Mass mailings
          </GroupTitle>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
            {mailings.map((c) => (
              <MailingRow key={c.id} c={c} now={now} results={results[c.id]} />
            ))}
          </ul>
        </section>
      ) : null}

      {sheets.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
          {sheets.map((s) => (
            <li key={s.id}>
              <Link href={`/campaigns/${s.id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-3 active:bg-surface-2 md:hover:bg-surface-2/60">
                <ProjectDot color={s.color} className="size-2.5 self-start mt-2 md:mt-1.5" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-medium text-fg md:text-sm">{s.name}</p>
                  <p className="mt-0.5 text-[13px] text-muted md:text-xs">
                    {s.rows} {s.rows === 1 ? "contact" : "contacts"}
                    {s.rows ? ` · ${stageSummary(s)}` : ""} · {s.currency}
                  </p>
                  {s.rows ? <StageBar sheet={s} /> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 md:flex-row md:items-center">
                  {s.followUpsDue ? (
                    <span className="whitespace-nowrap rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                      {s.followUpsDue} follow-up{s.followUpsDue === 1 ? "" : "s"} due
                    </span>
                  ) : null}
                  {s.noReply ? (
                    <span className="whitespace-nowrap rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                      {s.noReply} no reply
                    </span>
                  ) : null}
                </div>
                <ChevronRight className="size-5 shrink-0 text-subtle md:size-4" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No campaigns yet" action={<ButtonLink href="/campaigns?new=1" variant="primary">New campaign</ButtonLink>}>
          One per push, e.g. “Booking USA 2026/27”, “Gira España 2027”, “Press spring 2027” or “Partners NYC”.
        </EmptyState>
      )}
    </>
  );
}
