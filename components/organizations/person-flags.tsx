import { Badge } from "@/components/ui/badge";
import type { PersonFlags } from "@/lib/organizations/people";

/** "Decides" and "Talking" badges for a contact; nothing when neither applies. */
export function PersonFlagBadges({ flags, className }: { flags: PersonFlags | null | undefined; className?: string }) {
  if (!flags || (!flags.decides && !flags.talking)) return null;
  return (
    <span className={className ?? "flex shrink-0 items-center gap-1"}>
      {flags.decides ? (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="Books the artists or plans the season">
          Decides
        </Badge>
      ) : null}
      {flags.talking ? (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" title="Has written to us">
          Talking
        </Badge>
      ) : null}
    </span>
  );
}
