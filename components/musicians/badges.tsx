import { Badge } from "@/components/ui/badge";
import { ROSTER_STATUSES, type RosterStatus } from "@/lib/musicians/instruments";
import { cn } from "@/lib/utils";

const ROSTER_STYLES: Record<RosterStatus, string> = {
  roster: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  maybe: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  not_now: "bg-surface-2 text-muted",
};

export function RosterBadge({ roster, className }: { roster: RosterStatus; className?: string }) {
  const s = ROSTER_STATUSES.find((r) => r.value === roster);
  return (
    <Badge className={cn(ROSTER_STYLES[roster], className)} title={s?.hint}>
      {s?.short ?? roster}
    </Badge>
  );
}

/** ★★★☆☆ with an accessible label. */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("tracking-[0.1em] text-amber-500", className)} aria-label={`${value} out of 5`} title={`${value} out of 5`}>
      {"★".repeat(value)}
      <span className="text-border-strong">{"★".repeat(5 - value)}</span>
    </span>
  );
}
