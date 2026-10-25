import { FileText, KeyRound, Mail, MoreHorizontal } from "lucide-react";
import type { ListingMethod, SubmissionStatus } from "@/lib/listings/constants";
import type { PlatformForEvent } from "@/lib/queries/listings";

/** What the owner needs to see at a glance: still to do, on its way, out there, or closed. */
export type Stage = "pending" | "sent" | "published" | "closed";

export const STAGE_OF: Record<SubmissionStatus, Stage> = {
  todo: "pending",
  blocked: "pending",
  sent: "sent",
  received: "sent",
  published: "published",
  rejected: "closed",
  skipped: "closed",
};

export const STAGE_DOT: Record<Stage, string> = {
  pending: "bg-amber-500",
  sent: "bg-blue-500",
  published: "bg-emerald-500",
  closed: "bg-zinc-300 dark:bg-zinc-600",
};

export const statusOf = (p: PlatformForEvent): SubmissionStatus => p.submission?.status ?? "todo";
export const stageOf = (p: PlatformForEvent): Stage => STAGE_OF[statusOf(p)];

const METHOD: Record<ListingMethod, { icon: typeof Mail; label: string }> = {
  email: { icon: Mail, label: "Email" },
  form: { icon: FileText, label: "Form" },
  account: { icon: KeyRound, label: "Account" },
  other: { icon: MoreHorizontal, label: "Other" },
};

/** How a site takes the concert: an email, a web form, or an account to log into. */
export function MethodTag({ method }: { method: ListingMethod }) {
  const { icon: Icon, label } = METHOD[method];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-subtle md:text-[11px]">
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

/** Upcoming concerts (soonest first; one stays upcoming until its evening is over) and past ones. */
export function splitByDate<T extends { startsAt: Date }>(events: T[]): { upcoming: T[]; past: T[] } {
  const cutoff = Date.now() - 6 * 3600_000;
  return {
    upcoming: events.filter((e) => e.startsAt.getTime() >= cutoff).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    past: events.filter((e) => e.startsAt.getTime() < cutoff),
  };
}
