import {
  ArrowRightLeft,
  Mail,
  MessageCircle,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  StickyNote,
  Users,
  Voicemail,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LastTouch } from "@/lib/booking/timing";
import { ACTIVITY_KINDS, CALL_OUTCOMES } from "@/lib/constants";
import { daysBetween, formatRelative, toISODate } from "@/lib/dates";
import type { ActivityKind, CallOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Icons and wording for activities (calls, WhatsApp, meetings, hand-logged
 * emails, notes, status changes). Shared by the log dialog, the timeline,
 * and the sheet's "last touch" line.
 */

/** Everything the owner can log by hand ("status" entries are automatic). */
export type LoggableKind = Exclude<ActivityKind, "status">;

export const LOGGABLE_KINDS: { value: LoggableKind; short: string; title: string }[] = [
  { value: "call", short: "Call", title: "Log call" },
  { value: "whatsapp", short: "WhatsApp", title: "Log WhatsApp" },
  { value: "meeting", short: "Meeting", title: "Log meeting" },
  { value: "email", short: "Email", title: "Log email" },
  { value: "note", short: "Note", title: "Add note" },
];

const KIND_ICONS: Record<ActivityKind, LucideIcon> = {
  call: Phone,
  whatsapp: MessageCircle,
  meeting: Users,
  email: Mail,
  note: StickyNote,
  status: ArrowRightLeft,
};

const OUTCOME_ICONS: Record<CallOutcome, LucideIcon> = {
  reached: PhoneCall,
  no_answer: PhoneMissed,
  voicemail: Voicemail,
  call_back: PhoneIncoming,
  wrong_number: PhoneOff,
};

export function activityIconFor(kind: ActivityKind, outcome?: CallOutcome | null): LucideIcon {
  return kind === "call" && outcome ? OUTCOME_ICONS[outcome] : KIND_ICONS[kind];
}

/** Icon of an activity kind (a call shows its outcome: missed, voicemail…). */
export function ActivityIcon({
  kind,
  outcome,
  className,
}: {
  kind: ActivityKind;
  outcome?: CallOutcome | null;
  className?: string;
}) {
  const Icon = kind === "call" && outcome ? OUTCOME_ICONS[outcome] : KIND_ICONS[kind];
  return <Icon className={cn("size-4 shrink-0", className)} strokeWidth={1.75} aria-hidden />;
}

/** "Talked", "No answer"… ("" for null). */
export function outcomeLabel(outcome: CallOutcome | null | undefined): string {
  return outcome ? (CALL_OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome) : "";
}

/** Badge colors per call outcome. */
export const OUTCOME_TONE: Record<CallOutcome, string> = {
  reached: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  no_answer: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  voicemail: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  call_back: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  wrong_number: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function OutcomeBadge({ outcome }: { outcome: CallOutcome }) {
  return <Badge className={OUTCOME_TONE[outcome]}>{outcomeLabel(outcome)}</Badge>;
}

/** Past-tense name of a kind: "Called", "Met", "Emailed", "Note". */
export function activityPast(kind: ActivityKind): string {
  return ACTIVITY_KINDS.find((k) => k.value === kind)?.past ?? kind;
}

/** Short name of a kind: "Call", "WhatsApp", "Meeting", "Email", "Note", "Status". */
export function activityShort(kind: ActivityKind): string {
  return LOGGABLE_KINDS.find((k) => k.value === kind)?.short ?? "Status";
}

export type TouchTone = "muted" | "reply" | "waiting";

/** Text colors for describeLastTouch's tones. */
export const TOUCH_TONE_CLASS: Record<TouchTone, string> = {
  muted: "text-muted",
  reply: "font-medium text-fg",
  waiting: "text-warning",
};

/**
 * One line for a row's last touch (from lastTouch() in lib/booking/timing):
 * "Waiting on them · 6 days", "They wrote 2d ago", "You wrote yesterday",
 * "Called 3d ago · talked". `reply` = they wrote last (your move), `waiting`
 * = your email is unanswered.
 */
export function describeLastTouch(
  touch: LastTouch | null,
  timezone: string,
  /** 'YYYY-MM-DD' in `timezone`. */
  today: string,
): { text: string; tone: TouchTone } {
  if (!touch) return { text: "No contact yet", tone: "muted" };
  const at = new Date(touch.at);
  switch (touch.type) {
    case "awaiting": {
      const days = Math.max(0, daysBetween(toISODate(at, timezone), today));
      return { text: `Waiting on them · ${days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`}`, tone: "waiting" };
    }
    case "email_in":
      return { text: `They wrote ${formatRelative(at, timezone)}`, tone: "reply" };
    case "email_out":
      return { text: `You wrote ${formatRelative(at, timezone)}`, tone: "muted" };
    case "activity": {
      const outcome = touch.kind === "call" && touch.outcome ? ` · ${outcomeLabel(touch.outcome).toLowerCase()}` : "";
      return { text: `${activityPast(touch.kind)} ${formatRelative(at, timezone)}${outcome}`, tone: "muted" };
    }
  }
}
