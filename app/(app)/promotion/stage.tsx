import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, ExternalLink, FileText, KeyRound, Mail, MoreHorizontal } from "lucide-react";
import type { ListingMethod, SubmissionStatus } from "@/lib/listings/constants";
import type { PlatformForEvent } from "@/lib/queries/listings";
import { cn } from "@/lib/utils";

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

export const statusOf = (p: PlatformForEvent): SubmissionStatus => p.submission?.status ?? "todo";
export const stageOf = (p: PlatformForEvent): Stage => STAGE_OF[statusOf(p)];

/** Upcoming concerts (soonest first; one stays upcoming until its evening is over) and past ones. */
export function splitByDate<T extends { startsAt: Date }>(events: T[]): { upcoming: T[]; past: T[] } {
  const cutoff = Date.now() - 6 * 3600_000;
  return {
    upcoming: events.filter((e) => e.startsAt.getTime() >= cutoff).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    past: events.filter((e) => e.startsAt.getTime() < cutoff),
  };
}

/**
 * The sites a concert is tracked on: partners and every-concert listings,
 * plus any some-concerts listing already started for it. Split into the
 * groups the screens show.
 */
export function concertGroups(platforms: PlatformForEvent[]) {
  const routine = platforms.filter((p) => p.tier !== "skip");
  const partners = routine.filter((p) => p.kind === "partner");
  const always = routine.filter((p) => p.kind !== "partner" && p.tier === "always");
  const sometimes = routine.filter((p) => p.kind !== "partner" && p.tier === "sometimes");
  const tracked = [...partners, ...always, ...sometimes.filter((p) => statusOf(p) !== "todo")];
  const count = (stage: Stage) => tracked.filter((p) => stageOf(p) === stage).length;
  return {
    routine,
    partners,
    always,
    sometimes,
    counts: { pending: count("pending"), sent: count("sent"), published: count("published"), total: tracked.length - count("closed") },
  };
}

export type StageCounts = ReturnType<typeof concertGroups>["counts"];

/** Calendar-style date square (month over day), in the concert's time zone. */
export function DateTile({ startsAt, timeZone, className }: { startsAt: Date; timeZone: string; className?: string }) {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone, ...o }).format(startsAt);
  return (
    <span className={cn("flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 leading-none", className)} aria-hidden>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">{part({ month: "short" })}</span>
      <span className="mt-0.5 text-[20px] font-semibold tabular-nums text-fg">{part({ day: "numeric" })}</span>
    </span>
  );
}

/** Published, sent and pending as one thin bar. */
export function ProgressBar({ counts, className }: { counts: StageCounts; className?: string }) {
  const total = Math.max(counts.total, 1);
  return (
    <span className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-amber-200/70 dark:bg-amber-900/50", className)} aria-hidden>
      <span className="bg-emerald-500" style={{ width: `${(counts.published / total) * 100}%` }} />
      <span className="bg-blue-500" style={{ width: `${(counts.sent / total) * 100}%` }} />
    </span>
  );
}

export function CountsLine({ counts, className }: { counts: StageCounts; className?: string }) {
  return (
    <span className={cn("flex flex-wrap gap-x-2.5 text-[13px] text-muted md:text-xs", className)}>
      <span className={counts.pending ? "font-medium text-amber-700 dark:text-amber-400" : undefined}>{counts.pending} pending</span>
      <span className="text-blue-600 dark:text-blue-400">{counts.sent} sent</span>
      <span className="text-emerald-600 dark:text-emerald-400">{counts.published} published</span>
    </span>
  );
}

const METHOD: Record<ListingMethod, { icon: typeof Mail; label: string; tint: string }> = {
  email: { icon: Mail, label: "Email", tint: "bg-blue-500" },
  form: { icon: FileText, label: "Form", tint: "bg-violet-500" },
  account: { icon: KeyRound, label: "Account", tint: "bg-zinc-500" },
  other: { icon: MoreHorizontal, label: "Other", tint: "bg-zinc-400" },
};

export const methodName = (method: ListingMethod) => METHOD[method].label;

/** Settings-style colored icon: blue envelope for email, violet page for a form, gray key for an account. */
export function MethodIcon({ method }: { method: ListingMethod }) {
  const { icon: Icon, tint, label } = METHOD[method];
  return (
    <span className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-lg text-white md:size-7", tint)} title={label}>
      <Icon className="size-4" strokeWidth={2} aria-hidden />
    </span>
  );
}

/** Inset grouped list (iOS settings style) with an optional heading and footer. */
export function InsetGroup({ title, aside, footer, children, className }: { title?: ReactNode; aside?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {title ? (
        <h2 className="mb-1.5 flex items-end justify-between gap-3 px-4 text-[13px] uppercase tracking-wide text-subtle md:text-xs md:font-medium">
          <span>{title}</span>
          {aside ? <span className="normal-case tracking-normal">{aside}</span> : null}
        </h2>
      ) : null}
      <ul className="overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg [&>li+li]:border-t [&>li+li]:border-border">{children}</ul>
      {footer ? <p className="mt-1.5 px-4 text-[13px] text-subtle md:text-xs">{footer}</p> : null}
    </section>
  );
}

export const rowClass = "flex min-h-[52px] items-center gap-3 px-4 py-2 md:min-h-11";

/** A tappable row that pushes another screen. */
export function LinkRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <li>
      <Link href={href} className={cn(rowClass, "active:bg-surface-2 md:hover:bg-surface-2", className)}>
        {children}
        <ChevronRight className="size-5 shrink-0 text-subtle/70" aria-hidden />
      </Link>
    </li>
  );
}

/** Label on the left, value on the right. */
export function ValueRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className={cn(rowClass, "justify-between")}>
      <span className="shrink-0 text-[17px] text-fg md:text-sm">{label}</span>
      <span className="min-w-0 truncate text-right text-[17px] text-muted md:text-sm">{children}</span>
    </li>
  );
}

/** The small "View" button beside a published site: opens the listing as the public sees it. */
export function ViewLink({ href, name }: { href: string; name: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`View the listing on ${name}`}
      className="my-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-3 text-[15px] font-medium text-emerald-700 active:opacity-60 md:h-7 md:text-xs dark:bg-emerald-950 dark:text-emerald-300"
    >
      View
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}
