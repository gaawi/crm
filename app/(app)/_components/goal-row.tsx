import Link from "next/link";
import { NextStepLine } from "@/components/goals";
import { ProjectDot, StageBadge } from "@/components/ui/badge";
import { goalLabel, stageLabel } from "@/lib/constants";
import { formatDue } from "@/lib/dates";
import type { Opportunity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatMoney } from "../_lib/format";

/**
 * One goal in an inset list (contact, organization and project pages): its
 * title, type, status (named for its type) and next step with the due date.
 * Opens it in the pipeline.
 */
export function GoalRow({ deal: d, today, showContact = false }: { deal: Opportunity; today: string; showContact?: boolean }) {
  const closed = d.stage === "won" || d.stage === "lost";
  const value = formatMoney(d.value, d.currency);
  const type = goalLabel(d.kind);
  const meta = [
    // Titles made from the goal ("Get booked · Teatro Campoamor") already say it.
    d.title.startsWith(type) ? null : type,
    value,
    showContact ? d.contact?.displayName : null,
  ].filter(Boolean);
  return (
    <li className="relative flex min-h-[60px] items-center gap-3 px-4 py-2.5 active:bg-surface-2 md:min-h-0 md:hover:bg-surface-2/40">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {d.project ? <ProjectDot color={d.project.color} /> : null}
          <Link
            href={`/pipeline?open=${d.id}`}
            className={cn(
              "truncate text-[15px] font-medium after:absolute after:inset-0 md:text-sm md:hover:underline",
              d.stage === "lost" ? "text-muted" : "text-fg",
            )}
          >
            {d.title}
          </Link>
        </div>
        {meta.length ? <p className="truncate text-[13px] text-muted md:text-xs">{meta.join(" · ")}</p> : null}
        {closed ? null : <NextStepLine goal={d} className="mt-0.5" />}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StageBadge stage={d.stage} label={stageLabel(d.stage, d.kind)} />
        {d.followUpAt && !closed ? (
          <span className={cn("text-[12px] md:text-[11px]", d.followUpAt < today ? "font-medium text-danger" : "text-subtle")}>
            {formatDue(d.followUpAt, today)}
          </span>
        ) : null}
      </div>
    </li>
  );
}
