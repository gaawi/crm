import { ArrowRightLeft } from "lucide-react";
import { ActivityIcon, OutcomeBadge, activityShort } from "@/components/booking/activity-meta";
import type { TimelineExtra } from "@/components/email-timeline";
import type { ActivityView } from "@/lib/booking/types";
import { ACTIVITY_KINDS, CALL_OUTCOMES } from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { fold } from "@/lib/booking/filters";
import { cn } from "@/lib/utils";
import { HistoryActivityItem } from "./history-activity-item";

/**
 * Logged calls, WhatsApp messages, meetings, hand-logged emails, notes and
 * booking status changes as entries of the contact's email history
 * (EmailTimeline `extra`), in the same look as the emails around them.
 */

const ICON_TONE: Record<ActivityView["kind"], string> = {
  call: "text-blue-600 dark:text-blue-400",
  whatsapp: "text-emerald-600 dark:text-emerald-400",
  meeting: "text-blue-600 dark:text-blue-400",
  email: "text-blue-600 dark:text-blue-400",
  note: "text-subtle",
  status: "text-subtle",
};

function label(kind: ActivityView["kind"]): string {
  return kind === "email" ? (ACTIVITY_KINDS.find((k) => k.value === "email")?.label ?? "Email") : activityShort(kind);
}

/** Whether a history search ("q") matches the activity: its note, kind or call outcome, ignoring accents and case. */
export function activityMatches(activity: ActivityView, q: string, context?: string | null): boolean {
  const needle = fold(q.trim());
  if (!needle) return true;
  const outcome = activity.outcome ? (CALL_OUTCOMES.find((o) => o.value === activity.outcome)?.label ?? "") : "";
  return [activity.body, label(activity.kind), outcome, context].some((text) => fold(text).includes(needle));
}

function When({ at, timezone }: { at: Date; timezone: string }) {
  return (
    <time dateTime={at.toISOString()} title={formatDateTime(at, timezone)} className="ml-auto shrink-0 text-xs text-subtle">
      {formatRelative(at, timezone)}
    </time>
  );
}

/**
 * The expanded part: full date and time, and the row it was logged on (on
 * phones the row's name is left out of the collapsed line, so it shows here).
 */
function Details({ activity, at, timezone, context }: { activity: ActivityView; at: Date; timezone: string; context?: string | null }) {
  const status = activity.kind === "status";
  return (
    <span className="min-w-0">
      {formatDateTime(at, timezone)}
      {context ? <span className={status ? "md:hidden" : undefined}> · on {context}</span> : null}
      {status ? <span className="text-subtle"> · recorded automatically</span> : null}
    </span>
  );
}

/** One activity as a history entry. `context` names the booking row / deal it was logged on. */
export function activityExtra(activity: ActivityView, timezone: string, context?: string | null): TimelineExtra {
  const at = new Date(activity.occurredAt);
  const link = { opportunityId: activity.opportunityId, contactId: activity.contactId, organizationId: activity.organizationId };

  if (activity.kind === "status") {
    return {
      key: activity.id,
      at,
      node: (
        <HistoryActivityItem
          activityId={activity.id}
          what="this status entry (the status itself stays)"
          link={link}
          details={<Details activity={activity} at={at} timezone={timezone} context={context} />}
        >
          <ArrowRightLeft className="mt-0.5 size-4 shrink-0 text-subtle" strokeWidth={1.75} aria-label="Status change" />
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <p className="min-w-0 flex-1 text-[13px] text-muted md:text-xs">
              {context ? <span className="hidden text-fg/80 md:inline">{context}: </span> : null}
              {activity.body || "Status changed"}
            </p>
            <When at={at} timezone={timezone} />
          </div>
        </HistoryActivityItem>
      ),
    };
  }

  const name = label(activity.kind);
  return {
    key: activity.id,
    at,
    node: (
      <HistoryActivityItem
        activityId={activity.id}
        what={`this ${activity.kind === "email" ? "logged email" : name.toLowerCase()}`}
        link={link}
        details={<Details activity={activity} at={at} timezone={timezone} context={context} />}
      >
        <ActivityIcon kind={activity.kind} outcome={activity.outcome} className={cn("mt-0.5", ICON_TONE[activity.kind])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[15px] font-medium text-fg md:text-sm">{name}</span>
            {activity.outcome ? <OutcomeBadge outcome={activity.outcome} /> : null}
            {context ? <span className="hidden min-w-0 truncate text-xs text-subtle md:inline">· {context}</span> : null}
            <When at={at} timezone={timezone} />
          </div>
          {activity.body ? <p className="prose-plain mt-0.5 text-[15px] leading-snug text-fg/90 md:text-sm">{activity.body}</p> : null}
        </div>
      </HistoryActivityItem>
    ),
  };
}
