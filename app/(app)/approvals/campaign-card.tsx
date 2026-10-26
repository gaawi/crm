import Link from "next/link";
import { ChevronRight, Mails } from "lucide-react";
import { AccountBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { campaignSize, countParts, paceSentence, roundUpToTick, whenPhrase } from "@/lib/campaigns/format";
import type { CampaignSummary } from "@/lib/campaigns/types";
import { cn } from "@/lib/utils";
import { CampaignStatusBadge, CountList, ProgressBar } from "./campaign-ui";

/**
 * A campaign in Approvals: name, sheet, account, its emails by status, and
 * where it stands (waiting for approval / sending, next send / paused, why).
 * The whole card opens the campaign page.
 */
export function CampaignCard({ campaign: c, held, now }: { campaign: CampaignSummary; held: number; now: Date }) {
  const size = campaignSize(c.counts);
  const attention = held + c.counts.failed;
  const line =
    c.status === "draft"
      ? `Nothing is sent until you approve it · ${paceSentence(c)}`
      : c.status === "running"
        ? c.nextSendAt
          ? `${c.counts.sent} of ${size} sent · next ${whenPhrase(roundUpToTick(new Date(c.nextSendAt)), c.timezone, now)}`
          : `${c.counts.sent} of ${size} sent`
        : c.status === "paused"
          ? `${c.counts.sent} of ${size} sent · paused, nothing is being sent`
          : c.status === "done"
            ? `${c.counts.sent} of ${size} sent`
            : `${c.counts.sent} sent before it was cancelled`;

  const attentionText = [held ? `${held} held back` : "", c.counts.failed ? `${c.counts.failed} failed` : ""].filter(Boolean).join(", ");
  const waiting = c.status === "draft";
  const review = (className: string) => (
    <span className={cn(buttonClass(waiting ? "primary" : "secondary", "sm"), waiting && "border-red-600 bg-red-600 text-white hover:bg-red-700", className)}>
      {waiting ? "Read all" : "Review"}
      <ChevronRight className="-mr-1 size-4 md:hidden" aria-hidden />
    </span>
  );

  return (
    <Link
      href={`/approvals/mailings/${c.id}`}
      className={cn(
        "group block overflow-hidden rounded-xl border bg-surface active:bg-surface-2 md:rounded-lg",
        waiting ? "border-red-300 border-l-4 border-l-red-600 dark:border-red-900" : "border-border md:hover:border-border-strong",
      )}
    >
      {waiting ? (
        <p className="bg-red-50 px-4 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-red-700 dark:bg-red-950/50 dark:text-red-300">
          Mass mailing · {c.counts.proposed + c.counts.failed} emails go out when you approve
        </p>
      ) : null}
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          aria-hidden
          className={cn("mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-full md:inline-flex", waiting ? "bg-red-600 text-white" : "bg-surface-2 text-muted")}
        >
          <Mails className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 text-[17px] font-medium leading-snug text-fg md:text-sm">{c.name}</p>
            <CampaignStatusBadge status={c.status} />
          </div>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted md:text-xs">
            {c.projectName ? <span className="min-w-0 truncate">{c.projectName} ·</span> : null}
            <span className="flex items-center gap-1.5">
              from <AccountBadge email={c.accountEmail} />
            </span>
          </p>
          <CountList parts={countParts(c.counts, held)} className="mt-2" />
          {c.status !== "draft" ? <ProgressBar sent={c.counts.sent} held={held} failed={c.counts.failed} total={size} className="mt-2 max-w-sm" /> : null}
          <p className="mt-1.5 text-[13px] text-muted md:text-xs">{line}</p>
          {c.error && c.status === "paused" ? <p className="mt-1 text-[13px] text-warning md:text-xs">{c.error}</p> : null}
          {attention && c.status !== "draft" ? (
            <p className="mt-1 text-[13px] text-warning md:text-xs">
              {attention} {attention === 1 ? "email needs" : "emails need"} you: {attentionText}
            </p>
          ) : null}
          {review("mt-3 w-full md:hidden")}
        </div>
        {/* A wrapper: buttonClass sets inline-flex, which `hidden` cannot override. */}
        <span className="hidden shrink-0 self-center md:block">{review("")}</span>
      </div>
    </Link>
  );
}
