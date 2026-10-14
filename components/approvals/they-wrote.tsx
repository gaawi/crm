import { ArrowDownLeft } from "lucide-react";
import { formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** "Wrote to you · 2d ago": the contact wrote last and is waiting for an answer. */
export function TheyWroteBadge({ at, timezone, className }: { at: string; timezone?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[12px] font-semibold leading-tight text-success",
        className,
      )}
    >
      <ArrowDownLeft className="size-3.5" aria-hidden />
      Wrote to you{timezone ? ` · ${formatRelative(new Date(at), timezone)}` : ""}
    </span>
  );
}
