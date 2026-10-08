import {
  CalendarCheck,
  Clapperboard,
  FilePen,
  FileText,
  Handshake,
  Heart,
  Hourglass,
  Megaphone,
  Phone,
  Receipt,
  Reply,
  Signature,
  Target,
  Truck,
  Video,
  type LucideIcon,
} from "lucide-react";
import { GOAL_GROUPS, GOAL_KINDS, goalLabel, NEXT_ACTIONS, nextStepParts } from "@/lib/constants";
import { formatDue } from "@/lib/dates";
import type { NextAction, OpportunityKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Goals (what we want from a contact) and their structured next step, as
 * they read everywhere: "<icon> <label> · <detail> · <date>". No "use client"
 * and no server-only imports, so server pages and client components share it.
 */

/** NEXT_ACTIONS[].icon (lucide names) → components. */
const ICONS: Record<string, LucideIcon> = {
  Handshake,
  Phone,
  FileText,
  Clapperboard,
  Reply,
  Video,
  CalendarCheck,
  FilePen,
  Signature,
  Truck,
  Receipt,
  Heart,
  Megaphone,
  Hourglass,
};

/** The next action's icon; `fallback` (a target) when there is none, or nothing with fallback={false}. */
export function NextActionIcon({
  action,
  className,
  fallback = true,
  strokeWidth = 1.75,
}: {
  action: NextAction | null | undefined;
  className?: string;
  fallback?: boolean;
  strokeWidth?: number;
}) {
  const name = action ? NEXT_ACTIONS.find((a) => a.value === action)?.icon : undefined;
  const Icon = (name && ICONS[name]) || (fallback ? Target : null);
  if (!Icon) return null;
  return <Icon className={cn("size-3.5 shrink-0", className)} strokeWidth={strokeWidth} aria-hidden />;
}

/**
 * "☎ Call · ask for Ana · Tomorrow". The label is emphasized; the date (the
 * goal's follow-up / due date) shows only with `today` and turns red when
 * overdue. Renders `empty` (or nothing) when there is no action and no detail.
 */
export function NextStepLine({
  goal,
  today,
  closed = false,
  empty = null,
  wrap = false,
  className,
}: {
  goal: { nextAction: NextAction | null; nextStep: string | null; followUpAt: string | null };
  /** 'YYYY-MM-DD'; omit to leave the date out (shown elsewhere). */
  today?: string;
  /** Won / lost goals: the date is not "due" any more. */
  closed?: boolean;
  empty?: React.ReactNode;
  /** Let the text wrap instead of truncating. */
  wrap?: boolean;
  className?: string;
}) {
  const parts = nextStepParts(goal);
  const date = today && parts.date && !closed ? parts.date : null;
  if (!parts.label && !parts.detail && !date) return empty ? <>{empty}</> : null;
  const overdue = date !== null && today !== undefined && date < today;
  return (
    <p className={cn("flex min-w-0 gap-1.5 text-[13px] text-muted md:text-xs", wrap ? "items-start" : "items-center", className)}>
      {parts.action ? <NextActionIcon action={parts.action} className={cn("text-fg/70", wrap && "mt-px")} /> : null}
      <span className={wrap ? "min-w-0 [overflow-wrap:anywhere]" : "min-w-0 truncate"}>
        {parts.label ? <span className="font-medium text-fg/90">{parts.label}</span> : null}
        {parts.label && parts.detail ? " · " : null}
        {parts.detail}
        {date ? (
          <>
            {parts.label || parts.detail ? " · " : null}
            <span className={overdue ? "font-medium text-danger" : undefined}>{formatDue(date, today!)}</span>
          </>
        ) : null}
      </span>
    </p>
  );
}

/** <optgroup>s of the goal kinds for a <select> (Performances, Support, …). */
export function GoalKindOptions() {
  return (
    <>
      {GOAL_GROUPS.map((group) => (
        <optgroup key={group.value} label={group.label}>
          {GOAL_KINDS.filter((k) => k.group === group.value).map((k) => (
            <option key={k.value} value={k.value} title={k.hint || undefined}>
              {k.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/** <option>s of the next actions (add your own "none" option before them). */
export function NextActionOptions() {
  return (
    <>
      {NEXT_ACTIONS.map((a) => (
        <option key={a.value} value={a.value}>
          {a.label}
        </option>
      ))}
    </>
  );
}

/** Small "Get booked" / "Use of a space" badge. */
export function GoalBadge({ kind, className }: { kind: OpportunityKind; className?: string }) {
  const hint = GOAL_KINDS.find((k) => k.value === kind)?.hint;
  return (
    <span
      title={hint || undefined}
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1 whitespace-nowrap rounded border border-border px-1.5 text-[11px] font-medium leading-none text-muted",
        className,
      )}
    >
      <Target className="size-3 shrink-0" strokeWidth={2} aria-hidden />
      <span className="truncate">{goalLabel(kind)}</span>
    </span>
  );
}
