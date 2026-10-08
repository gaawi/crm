import { Badge } from "@/components/ui/badge";
import type { CountPart, CountTone } from "@/lib/campaigns/format";
import { CAMPAIGN_STATUSES, type CampaignStatus } from "@/lib/campaigns/types";
import { cn } from "@/lib/utils";

/** Presentational bits shared by the Approvals campaign cards and the campaign page (server or client). */

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  running: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  paused: "bg-zinc-200/70 text-fg dark:bg-zinc-800",
  done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled: "bg-surface-2 text-subtle",
};

export function campaignStatusLabel(status: CampaignStatus): string {
  return CAMPAIGN_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function CampaignStatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  const meta = CAMPAIGN_STATUSES.find((s) => s.value === status);
  return (
    <Badge className={cn(STATUS_STYLES[status], className)} title={meta?.hint}>
      {status === "running" ? <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden /> : null}
      {meta?.label ?? status}
    </Badge>
  );
}

const TONE_NUMBER: Record<CountTone, string> = {
  default: "text-fg",
  info: "text-blue-700 dark:text-blue-300",
  success: "text-emerald-700 dark:text-emerald-400",
  warning: "text-warning",
  danger: "text-danger",
  subtle: "text-subtle",
};

/** "87 to approve · 3 sent · 1 held back" as small number + label pairs. */
export function CountList({ parts, className }: { parts: CountPart[]; className?: string }) {
  if (!parts.length) return <p className={cn("text-[13px] text-muted md:text-xs", className)}>No emails</p>;
  return (
    <ul className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] md:text-xs", className)}>
      {parts.map((p) => (
        <li key={p.key} className="whitespace-nowrap">
          <span className={cn("font-semibold tabular-nums", TONE_NUMBER[p.tone])}>{p.count}</span>{" "}
          <span className="text-muted">{p.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Sent of total, as a thin bar (failed and held-back emails in their own colors). */
export function ProgressBar({ sent, held, failed, total, className }: { sent: number; held: number; failed: number; total: number; className?: string }) {
  if (total <= 0) return null;
  const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`;
  return (
    <div
      role="progressbar"
      aria-label="Sent"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={sent}
      aria-valuetext={`${sent} of ${total} sent`}
      className={cn("flex h-1.5 overflow-hidden rounded-full bg-surface-2", className)}
    >
      <span className="bg-emerald-500" style={{ width: pct(sent) }} />
      {held ? <span className="bg-amber-400" style={{ width: pct(held) }} /> : null}
      {failed ? <span className="bg-red-500" style={{ width: pct(failed) }} /> : null}
    </div>
  );
}
