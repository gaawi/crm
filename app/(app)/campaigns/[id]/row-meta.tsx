"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Clock, Flame, History, Loader2, Mail, MailCheck, RotateCcw } from "lucide-react";
import { ActivityIcon, describeLastTouch, TOUCH_TONE_CLASS } from "@/components/booking/activity-meta";
import { phoneActionClass, type PhoneActionSize } from "@/components/booking/phone-action-class";
import { PlaceLink } from "@/components/organizations/place-link";
import { Badge } from "@/components/ui/badge";
import { lastTouch, rowFollowUpTiming, type LastTouch } from "@/lib/booking/timing";
import type { EmailTemplate, SheetRow } from "@/lib/booking/types";
import { OPPORTUNITY_STAGES, stageLabel } from "@/lib/constants";
import { orgPlace } from "@/lib/organizations/profile";
import type { OpportunityKind, OpportunityStage } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Presentational pieces shared by the desktop table, the phone cards and the History drawer. */

/** Dot / stripe color per booking status. */
export const STAGE_DOT: Record<OpportunityStage, string> = {
  lead: "bg-zinc-300 dark:bg-zinc-600",
  contacted: "bg-blue-500",
  proposal: "bg-violet-500",
  negotiation: "bg-amber-500",
  won: "bg-emerald-500",
  lost: "bg-zinc-400 dark:bg-zinc-500",
};

export const STAGE_STRIPE: Record<OpportunityStage, string> = {
  lead: "border-l-zinc-200 dark:border-l-zinc-700",
  contacted: "border-l-blue-500",
  proposal: "border-l-violet-500",
  negotiation: "border-l-amber-500",
  won: "border-l-emerald-500",
  lost: "border-l-zinc-300 dark:border-l-zinc-600",
};

/**
 * Status options named for a goal kind ("To contact", "Offer sent"… for
 * booking; "To ask", "Granted"… for a space); null = the generic names
 * (a sheet mixing goals).
 */
export function stageOptions(kind: OpportunityKind | null): { value: OpportunityStage; label: string }[] {
  return OPPORTUNITY_STAGES.map((s) => ({ value: s.value, label: stageLabel(s.value, kind) }));
}

/** What a row can ask the sheet to do (stable callbacks from SheetView). */
export interface RowActions {
  onToggle: (rowId: string) => void;
  onHistory: (rowId: string) => void;
  /** Open the log dialog for the row (after a Call / WhatsApp tap). */
  onLog: (row: SheetRow, kind: "call" | "whatsapp") => void;
  onPrepare: (row: SheetRow) => void;
}

/** Values every row reads. */
export interface RowContext {
  currency: string;
  today: string;
  timezone: string;
  /** id of the sections <datalist>. */
  sectionsListId: string;
}

export function venueName(row: Pick<SheetRow, "organization" | "title">): string {
  return row.organization?.name ?? row.title;
}

/** Where the row's organization is ("Kuopio, Finland"), linked to Google Maps; nothing when unknown. */
export function RowPlace({ row, className, block = false }: { row: Pick<SheetRow, "organization">; className?: string; block?: boolean }) {
  const place = orgPlace(row.organization, row.organization?.profile);
  if (!place) return null;
  const link = <PlaceLink place={place} className={block ? undefined : className} iconClassName="size-3" />;
  return block ? <div className={cn("flex min-w-0", className)}>{link}</div> : link;
}

/** "María López · Teatro Jovellanos" (for the log dialog and the drawer). */
export function rowSubject(row: Pick<SheetRow, "organization" | "title" | "contact">): string {
  return [row.contact?.displayName, venueName(row)].filter(Boolean).join(" · ");
}

/** Returning (worked together before) and Hot (In conversation). `iconOnly`: just the icons (compact cards). */
export function RowBadges({
  row,
  iconOnly = false,
  className,
}: {
  row: Pick<SheetRow, "returning" | "stage">;
  iconOnly?: boolean;
  className?: string;
}) {
  if (!row.returning && row.stage !== "negotiation") return null;
  if (iconOnly) {
    return (
      <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
        {row.returning ? (
          <RotateCcw className="size-3.5 text-violet-600 dark:text-violet-400" strokeWidth={2} aria-label="Returning" />
        ) : null}
        {row.stage === "negotiation" ? <Flame className="size-3.5 text-amber-600 dark:text-amber-400" strokeWidth={2} aria-label="Hot" /> : null}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {row.returning ? (
        <Badge className="bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300" title="Worked with us before">
          <RotateCcw className="size-3" strokeWidth={2} aria-hidden />
          Returning
        </Badge>
      ) : null}
      {row.stage === "negotiation" ? (
        <Badge className="bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="In conversation">
          <Flame className="size-3" strokeWidth={2} aria-hidden />
          Hot
        </Badge>
      ) : null}
    </span>
  );
}

function TouchIcon({ touch }: { touch: LastTouch | null }) {
  const cls = "size-3.5 shrink-0 md:size-3";
  if (!touch) return null;
  switch (touch.type) {
    case "awaiting":
      return <Clock className={cls} strokeWidth={2} aria-hidden />;
    case "email_in":
      return <ArrowDownLeft className={cls} strokeWidth={2} aria-hidden />;
    case "email_out":
      return <ArrowUpRight className={cls} strokeWidth={2} aria-hidden />;
    case "activity":
      return <ActivityIcon kind={touch.kind} outcome={touch.outcome} className={cls} />;
  }
}

/** "☎ Called 3d ago · talked", "Waiting on them · 6 days", "They wrote yesterday"… */
export function LastTouchLine({
  row,
  timezone,
  today,
  wrap = false,
  className,
}: {
  row: SheetRow;
  timezone: string;
  today: string;
  /** Wrap onto a second line (narrow table column) instead of truncating. */
  wrap?: boolean;
  className?: string;
}) {
  const touch = lastTouch(row);
  const described = describeLastTouch(touch, timezone, today);
  // "No contact yet" would read as "no contact person" next to the contact's name;
  // and a row imported as Contacted (or later) was contacted, just not here.
  const { text, tone } = touch ? described : { text: row.stage === "lead" ? "Not contacted yet" : "No emails or calls logged", tone: described.tone };
  return (
    <p className={cn("flex min-w-0 gap-1 text-[13px] md:text-xs", wrap ? "items-start [&>svg]:mt-px" : "items-center", TOUCH_TONE_CLASS[tone], className)}>
      <TouchIcon touch={touch} />
      {/* Relative times ("3h ago") may differ by a minute between the server render and hydration. */}
      <span className={wrap ? "min-w-0" : "truncate"} suppressHydrationWarning>
        {text}
      </span>
    </p>
  );
}

/** When to follow up an unanswered email: wait / good time / overdue (Contacted and Offer sent rows). */
export function TimingBadge({
  row,
  timezone,
  today,
  wrap = false,
  className,
}: {
  row: SheetRow;
  timezone: string;
  today: string;
  /** Let the text wrap (narrow table column) instead of truncating. */
  wrap?: boolean;
  className?: string;
}) {
  const timing = rowFollowUpTiming(row, today, timezone);
  if (!timing) return null;
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  const [text, tone, title] =
    timing.state === "wait"
      ? [`Wait ${days(timing.waitDays)}`, "font-normal", `Your email is ${days(timing.days)} old. Follow up from ${timing.suggestedDate}.`]
      : timing.state === "ready"
        ? [`Good time to follow up (${days(timing.days)})`, "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", undefined]
        : [`${days(timing.days)} — follow up now`, "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300", "No reply for more than 10 days"];
  return (
    <Badge className={cn("max-w-full", wrap && "h-auto min-h-5 whitespace-normal py-0.5 leading-tight", tone, className)} title={title ?? text}>
      <span className={wrap ? undefined : "truncate"}>{text}</span>
    </Badge>
  );
}

/** The template a row's Prepare email would use, or why it can't. */
export interface EmailSuggestion {
  template: EmailTemplate | null;
  /** Set when the button is disabled ("No email address"…). */
  reason: string | null;
  /** An email to this contact already waits in Approvals: the button opens it instead. */
  draftId?: string | null;
}

/**
 * "Prepare email": puts an email from the suggested template in Approvals
 * (never sends). Labelled with the template's name; disabled with the reason
 * as a tooltip.
 */
export function PrepareEmailButton({
  suggestion,
  pending,
  onPrepare,
  size,
  className,
}: {
  suggestion: EmailSuggestion;
  pending: boolean;
  onPrepare: () => void;
  /** "compact": the table's small button; otherwise a phone tile / labelled button. */
  size: "compact" | PhoneActionSize;
  className?: string;
}) {
  const name = suggestion.template?.name;
  const title = suggestion.reason ?? `Prepare “${name}” — it goes to Approvals, nothing is sent`;
  const icon = pending ? (
    <Loader2 className={cn("animate-spin", size === "tile" ? "size-5 md:size-[18px]" : "size-3.5")} aria-hidden />
  ) : (
    <Mail className={size === "tile" ? "size-5 md:size-[18px]" : "size-3.5"} strokeWidth={1.75} aria-hidden />
  );
  if (suggestion.draftId) {
    const href = `/approvals/${suggestion.draftId}`;
    const waiting = "An email to them is waiting in Approvals: review and send it from there";
    return size === "compact" ? (
      <Link
        href={href}
        title={waiting}
        className={cn(
          "inline-flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg",
          className,
        )}
      >
        <MailCheck className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {/* The table's narrow column: "Approvals" fits, the tooltip says the rest. */}
        <span className="truncate">Approvals</span>
      </Link>
    ) : (
      <Link href={href} title={waiting} className={phoneActionClass(size, className)}>
        <MailCheck className={size === "tile" ? "size-5 md:size-[18px]" : "size-3.5"} strokeWidth={1.75} aria-hidden />
        <span className={size === "tile" ? "max-w-full truncate" : undefined}>{size === "tile" ? "Approvals" : "In Approvals"}</span>
      </Link>
    );
  }
  if (size === "compact") {
    return (
      <button
        type="button"
        onClick={onPrepare}
        disabled={pending || Boolean(suggestion.reason)}
        title={title}
        aria-label={suggestion.reason ? `Prepare email: ${suggestion.reason}` : `Prepare email: ${name}`}
        className={cn(
          "inline-flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs font-medium text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45",
          className,
        )}
      >
        {icon}
        <span className="truncate">{name ?? "Email"}</span>
      </button>
    );
  }
  // Phones have no tooltips: a disabled tile still answers a tap with the reason.
  return (
    <button
      type="button"
      onClick={onPrepare}
      disabled={pending}
      aria-disabled={suggestion.reason ? true : undefined}
      title={title}
      aria-label={suggestion.reason ? `Prepare email: ${suggestion.reason}` : `Prepare email: ${name}`}
      className={phoneActionClass(size, cn(suggestion.reason && "opacity-40", className))}
    >
      {icon}
      <span className={size === "tile" ? "max-w-full truncate" : undefined}>{size === "tile" ? "Email" : name ? `Email · ${name}` : "Prepare email"}</span>
    </button>
  );
}

/** History tile / icon (opens the drawer) with the number of logged activities. */
export function HistoryButton({
  count,
  onOpen,
  size,
  className,
}: {
  count: number;
  onOpen: () => void;
  /** "compact": the table's small icon + count. */
  size: PhoneActionSize | "compact";
  className?: string;
}) {
  if (size === "compact") {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`History${count ? ` (${count} logged)` : ""}`}
        title="History: calls, notes and emails"
        className={cn("inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs tabular-nums text-subtle hover:bg-surface-2 hover:text-fg", className)}
      >
        <History className="size-4" strokeWidth={1.75} aria-hidden />
        {count ? <span>{count}</span> : null}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`History${count ? ` (${count} logged)` : ""}`}
      title="History: calls, notes and emails"
      className={phoneActionClass(size, cn("relative", className))}
    >
      <History className={size === "tile" ? "size-5 md:size-[18px]" : "size-4"} strokeWidth={1.75} aria-hidden />
      {size === "tile" ? <span>History</span> : null}
      {count > 0 && size !== "button" ? (
        <span
          className={cn(
            "absolute flex min-w-4 items-center justify-center rounded-full bg-surface-2 px-1 text-[10px] font-semibold leading-4 text-muted tabular-nums ring-1 ring-border",
            size === "tile" ? "right-2 top-1.5" : "-right-1 -top-1",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
