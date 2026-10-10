"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, CircleCheck, CircleX, Trash2 } from "lucide-react";
import { contactTimelineAction, deleteActivityAction } from "@/app/(app)/activity-actions";
import { updateCellAction, timelineAction } from "@/app/(app)/campaigns/actions";
import { iconButtonClass } from "@/app/(app)/_components/ui";
import type { Timeline, TimelineItem } from "@/lib/booking/types";
import { ACTIVITY_KINDS, stageLabel } from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/dates";
import type { OpportunityKind, OpportunityStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { emitActivityChanged, useActivityChanged, type ActivityChangedDetail } from "./activity-events";
import { ActivityIcon, LOGGABLE_KINDS, OutcomeBadge, activityShort, type LoggableKind } from "./activity-meta";
import { useActivityLogger, type ActivityTarget } from "./log-activity-dialog";

/**
 * A row's or contact's history: logged activities (calls with their outcome,
 * WhatsApp, meetings, hand-logged emails, notes, status changes) mixed with
 * the emails synced from Gmail (↗ sent, ↙ received; each opens its thread in
 * Mail), newest first. A quick-add row on top logs Call / WhatsApp / Note /
 * Meeting / Email (through the log dialog) and, for a booking row, sets
 * Confirmed / Declined (the status change is logged too).
 *
 * <ActivityTimeline> renders the items it is given (server-loaded pages:
 * they refresh by themselves after each action). <LiveTimeline> loads them
 * with a server action and reloads after any activity change (the sheet's
 * History drawer).
 */

type Filter = "all" | "activity" | "email";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "activity", label: "Calls & notes" },
  { value: "email", label: "Emails" },
];

const QUICK_KINDS: LoggableKind[] = ["call", "whatsapp", "note", "meeting", "email"];

const quickClass =
  "flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface px-1 text-[12px] font-medium text-fg transition-colors active:bg-surface-2 disabled:pointer-events-none disabled:opacity-50 md:h-7 md:flex-row md:gap-1.5 md:rounded-md md:px-2.5 md:text-xs md:hover:bg-surface-2";

export function ActivityTimeline({
  items,
  target,
  timezone,
  stage,
  kind: goalKind = "booking",
  phone,
  subject,
  quickAdd = true,
  loading = false,
  emptyText = "Nothing yet. Calls, notes and emails with them show up here.",
  onChanged,
  className,
}: {
  /** Newest first (Timeline.items). */
  items: TimelineItem[];
  /** Where quick-add entries are logged: { opportunityId } for a booking row, { contactId } for a person. */
  target: ActivityTarget;
  /** Owner's timezone (env.timezone). */
  timezone: string;
  /** The booking row's status: with target.opportunityId, shows Confirmed / Declined. */
  stage?: OpportunityStage | null;
  /** The row's goal: names those two buttons ("Confirmed" for booking, "Granted" for a space…). */
  kind?: OpportunityKind;
  /** Their number, offered as "Call …" inside the log dialog. */
  phone?: string | null;
  /** Shown in the log dialog: "María López · Teatro Jovellanos". */
  subject?: string | null;
  /** false: no quick-add row (read-only history). */
  quickAdd?: boolean;
  /** Dims the list while a newer version loads. */
  loading?: boolean;
  emptyText?: string;
  /** After this component logged, deleted or changed something (ACTIVITY_CHANGED_EVENT fires too). */
  onChanged?: () => void;
  className?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [stagePending, startStage] = useTransition();
  const [, startDelete] = useTransition();
  const logger = useActivityLogger({ timezone, onLogged: () => onChanged?.() });

  const visible = items.filter((item) => !(item.type === "activity" && hidden.has(item.id)));
  const hasEmails = visible.some((i) => i.type === "email");
  const hasActivities = visible.some((i) => i.type === "activity");
  const shown = visible.filter((i) => filter === "all" || (filter === "email" ? i.type === "email" : i.type === "activity"));
  const rowId = target.opportunityId || null;
  const showStage = Boolean(rowId && stage !== undefined && stage !== null);

  function setStage(next: "won" | "lost") {
    if (!rowId) return;
    setError(null);
    startStage(async () => {
      const result = await updateCellAction(rowId, "stage", next).catch(() => ({ ok: false, error: "Not saved. Try again." }));
      if (!result.ok) {
        setError(result.error ?? "Not saved.");
        return;
      }
      emitActivityChanged({ opportunityId: rowId });
      onChanged?.();
    });
  }

  function remove(item: Extract<TimelineItem, { type: "activity" }>) {
    const what = item.kind === "status" ? "this status entry (the status itself stays)" : `this ${activityShort(item.kind).toLowerCase()}`;
    if (!window.confirm(`Delete ${what} from the history?`)) return;
    setError(null);
    setHidden((prev) => new Set(prev).add(item.id));
    startDelete(async () => {
      const result = await deleteActivityAction(item.id).catch(() => ({ ok: false as const, error: "Not deleted. Try again." }));
      if (!result.ok && result.error !== "Already deleted") {
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        setError(result.error);
        return;
      }
      emitActivityChanged({ opportunityId: item.opportunityId, contactId: item.contactId, organizationId: item.organizationId });
      onChanged?.();
    });
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {quickAdd ? (
        <div className="grid grid-cols-4 gap-2 md:flex md:flex-wrap md:gap-x-3 md:gap-y-1.5">
          {/* Phones: one 4-column grid of tiles; desktop: two compact button groups that wrap as units. */}
          <div className="contents md:flex md:flex-wrap md:gap-1.5" role="group" aria-label="Add to history">
            {QUICK_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={quickClass}
                title={LOGGABLE_KINDS.find((k) => k.value === kind)?.title}
                onClick={() => logger.open({ target, kind, subject, phone })}
              >
                <ActivityIcon kind={kind} className="size-5 text-muted md:size-3.5" />
                <span className="max-w-full truncate">{activityShort(kind)}</span>
              </button>
            ))}
          </div>
          {showStage ? (
            <div className="contents md:flex md:gap-1.5" role="group" aria-label="Set status">
              <button
                type="button"
                className={cn(quickClass, stage === "won" && "border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950")}
                disabled={stagePending || stage === "won"}
                aria-pressed={stage === "won"}
                title={stage === "won" ? stageLabel("won", goalKind) : `Set the status to ${stageLabel("won", goalKind)}`}
                onClick={() => setStage("won")}
              >
                <CircleCheck className="size-5 text-emerald-600 md:size-3.5 dark:text-emerald-400" strokeWidth={1.75} aria-hidden />
                <span className="max-w-full truncate">{stageLabel("won", goalKind)}</span>
              </button>
              <button
                type="button"
                className={cn(quickClass, stage === "lost" && "bg-surface-2")}
                disabled={stagePending || stage === "lost"}
                aria-pressed={stage === "lost"}
                title={stage === "lost" ? stageLabel("lost", goalKind) : `Set the status to ${stageLabel("lost", goalKind)}`}
                onClick={() => setStage("lost")}
              >
                <CircleX className="size-5 text-subtle md:size-3.5" strokeWidth={1.75} aria-hidden />
                <span className="max-w-full truncate">{stageLabel("lost", goalKind)}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {hasEmails && hasActivities ? (
        <div className="flex gap-0.5 self-start rounded-[10px] bg-surface-2 p-0.5 md:rounded-lg" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "flex h-8 items-center rounded-lg px-3 text-[13px] font-medium transition-colors md:h-7 md:rounded-md md:text-xs",
                filter === f.value ? "bg-surface text-fg shadow-sm dark:bg-border-strong" : "text-muted active:opacity-60 md:hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      {shown.length ? (
        <ol
          className={cn(
            "divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface transition-opacity md:rounded-lg",
            loading && "opacity-60",
          )}
          aria-busy={loading}
        >
          {shown.map((item) =>
            item.type === "email" ? (
              <EmailEntry key={`e:${item.id}`} item={item} timezone={timezone} />
            ) : (
              <ActivityEntry key={`a:${item.id}`} item={item} timezone={timezone} onDelete={() => remove(item)} />
            ),
          )}
        </ol>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted md:rounded-lg">
          {filter === "all" ? emptyText : "Nothing here."}
        </p>
      )}
      {items.length >= 100 ? <p className="text-center text-xs text-subtle">Showing the latest 100 entries.</p> : null}
      {logger.dialog}
    </div>
  );
}

function When({ at, timezone }: { at: string; timezone: string }) {
  const date = new Date(at);
  return (
    <time dateTime={at} title={formatDateTime(date, timezone)} suppressHydrationWarning className="ml-auto shrink-0 text-xs text-subtle">
      {formatRelative(date, timezone)}
    </time>
  );
}

const deleteClass = cn(iconButtonClass, "-my-1.5 -mr-2 md:-my-0.5 md:-mr-1 md:hover:text-danger");

function ActivityEntry({
  item,
  timezone,
  onDelete,
}: {
  item: Extract<TimelineItem, { type: "activity" }>;
  timezone: string;
  onDelete: () => void;
}) {
  if (item.kind === "status") {
    return (
      <li className="flex items-center gap-3 px-4 py-2 text-[13px] text-muted md:px-3 md:py-1.5 md:text-xs">
        <span className="flex size-8 shrink-0 items-center justify-center md:size-7" aria-hidden>
          <ArrowRightLeft className="size-3.5 text-subtle" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate" title={item.body ?? undefined}>
          {item.body || "Status changed"}
        </span>
        <When at={item.at} timezone={timezone} />
        <button type="button" onClick={onDelete} aria-label="Delete this status entry" title="Delete" className={deleteClass}>
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </button>
      </li>
    );
  }
  const label = item.kind === "email" ? (ACTIVITY_KINDS.find((k) => k.value === "email")?.label ?? "Email") : activityShort(item.kind);
  return (
    <li className="flex gap-3 px-4 py-3 md:px-3 md:py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted md:size-7">
        <ActivityIcon kind={item.kind} outcome={item.outcome} className="md:size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 md:min-h-7">
          <span className="text-[15px] font-medium text-fg md:text-sm">{label}</span>
          {item.outcome ? <OutcomeBadge outcome={item.outcome} /> : null}
          <When at={item.at} timezone={timezone} />
        </div>
        {item.body ? <p className="prose-plain text-[15px] leading-snug text-fg/90 md:text-sm">{item.body}</p> : null}
      </div>
      <button type="button" onClick={onDelete} aria-label={`Delete this ${label.toLowerCase()}`} title="Delete" className={cn(deleteClass, "mt-0.5 md:mt-0")}>
        <Trash2 className="size-4 md:size-3.5" strokeWidth={1.75} />
      </button>
    </li>
  );
}

function EmailEntry({ item, timezone }: { item: Extract<TimelineItem, { type: "email" }>; timezone: string }) {
  const outbound = item.direction === "outbound";
  const Icon = outbound ? ArrowUpRight : ArrowDownLeft;
  return (
    <li>
      <Link href={item.href} className="flex gap-3 px-4 py-3 active:bg-surface-2 md:px-3 md:py-2.5 md:hover:bg-surface-2/60">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full md:size-7",
            outbound ? "bg-surface-2 text-subtle" : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
          )}
        >
          <Icon className="size-4 md:size-3.5" strokeWidth={1.75} aria-label={outbound ? "Sent" : "Received"} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-8 items-center gap-2 md:min-h-7">
            <span className="shrink-0 text-[15px] font-medium text-fg md:text-sm">{outbound ? "You wrote" : "They wrote"}</span>
            <span className="hidden min-w-0 truncate text-xs text-subtle md:inline">via {item.accountEmail}</span>
            <When at={item.at} timezone={timezone} />
          </div>
          <p className="truncate text-[15px] text-fg md:text-sm">{item.subject || "(no subject)"}</p>
          {item.snippet ? <p className="line-clamp-2 text-[13px] text-muted md:line-clamp-1 md:text-xs">{item.snippet}</p> : null}
        </div>
      </Link>
    </li>
  );
}

type Source = { rowId: string } | { contactId: string };

function sameIds(detail: ActivityChangedDetail, ids: (string | null | undefined)[]): boolean {
  const wanted = new Set(ids.filter(Boolean));
  return [detail.opportunityId, detail.contactId, detail.organizationId].some((id) => id && wanted.has(id));
}

/**
 * <ActivityTimeline> that loads itself (timelineAction for a row,
 * contactTimelineAction for a contact) and reloads whenever an activity of
 * that row / contact / organization changes anywhere on the page.
 */
export function LiveTimeline({
  source,
  timezone,
  initial,
  stage,
  kind,
  phone,
  subject,
  quickAdd = true,
  emptyText,
  className,
}: {
  /** { rowId } = a booking row (opportunity id); { contactId } = a person. */
  source: Source;
  timezone: string;
  /** Already-loaded timeline for this source (skips the first request). */
  initial?: Timeline | null;
  /** The row's status (Confirmed / Declined quick-adds; rows only). */
  stage?: OpportunityStage | null;
  /** The row's goal (names those quick-adds). */
  kind?: OpportunityKind;
  phone?: string | null;
  subject?: string | null;
  quickAdd?: boolean;
  emptyText?: string;
  className?: string;
}) {
  const sourceKind = "rowId" in source ? "row" : "contact";
  const sourceId = "rowId" in source ? source.rowId : source.contactId;
  const sourceKey = `${sourceKind}:${sourceId}`;
  const [version, setVersion] = useState(0);
  const wantKey = `${sourceKey}#${version}`;
  const [loaded, setLoaded] = useState<{ key: string; timeline: Timeline | null; error: string | null } | null>(() =>
    initial ? { key: `${sourceKey}#0`, timeline: initial, error: null } : null,
  );
  const skipKey = useRef(initial ? `${sourceKey}#0` : null);

  useEffect(() => {
    if (skipKey.current === wantKey) return;
    skipKey.current = null;
    let cancelled = false;
    const request = sourceKind === "row" ? timelineAction(sourceId) : contactTimelineAction(sourceId);
    request
      .then((result) => {
        if (!cancelled) setLoaded({ key: wantKey, timeline: result.ok ? result.timeline : null, error: result.ok ? null : result.error });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: wantKey, timeline: null, error: "Could not load the history." });
      });
    return () => {
      cancelled = true;
    };
  }, [wantKey, sourceKind, sourceId]);

  // The latest result for this source (possibly one version old while reloading).
  const current = loaded && loaded.key.startsWith(`${sourceKey}#`) ? loaded : null;
  const timeline = current?.timeline ?? null;

  useActivityChanged((detail) => {
    const ids = timeline ? [timeline.opportunityId, timeline.contactId, timeline.organizationId, sourceId] : [sourceId];
    if (sameIds(detail, ids)) setVersion((v) => v + 1);
  });

  const target: ActivityTarget = sourceKind === "row" ? { opportunityId: sourceId } : { contactId: sourceId };

  if (!current) {
    return (
      <div className={cn("flex flex-col gap-3", className)} aria-busy>
        <div className="h-14 animate-pulse rounded-xl bg-surface-2 md:h-7 md:rounded-md" />
        <div className="h-40 animate-pulse rounded-xl bg-surface-2 md:rounded-lg" />
      </div>
    );
  }
  if (!timeline) {
    return (
      <div className={cn("flex flex-col items-start gap-2 text-sm", className)}>
        <p role="alert" className="text-danger">
          {current.error ?? "Could not load the history."}
        </p>
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          className="flex h-11 items-center text-[15px] text-muted active:opacity-60 md:h-auto md:text-sm md:hover:text-fg"
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <ActivityTimeline
      items={timeline.items}
      target={target}
      timezone={timezone}
      stage={stage}
      kind={kind}
      phone={phone}
      subject={subject}
      quickAdd={quickAdd}
      loading={current.key !== wantKey}
      emptyText={emptyText}
      className={className}
    />
  );
}
