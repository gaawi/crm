"use client";

import { useCallback, useId, useState, useTransition, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Phone } from "lucide-react";
import { addActivityAction } from "@/app/(app)/activity-actions";
import { NextActionOptions } from "@/components/goals";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { callFollowUpPreset } from "@/lib/booking/timing";
import { formatPhone, telHref } from "@/lib/booking/phone";
import type { ActivityView } from "@/lib/booking/types";
import { CALL_OUTCOMES } from "@/lib/constants";
import { todayIn, toDateTimeLocal } from "@/lib/dates";
import type { CallOutcome, NextAction, OpportunityStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { emitActivityChanged } from "./activity-events";
import { ActivityIcon, LOGGABLE_KINDS, type LoggableKind } from "./activity-meta";

/**
 * Log a call (with its outcome), WhatsApp, meeting, hand-logged email or
 * note, optionally with a follow-up. A dialog on desktop, a full-screen
 * sheet on phones. Saves through addActivityAction itself; on success it
 * fires ACTIVITY_CHANGED_EVENT, calls onLogged and closes.
 *
 * Three ways in:
 * - <LogActivityDialog open onClose …/>: controlled.
 * - useActivityLogger({ timezone }): one dialog for a whole list; call
 *   `open({ target, kind, … })` from any row and render `dialog` once.
 * - <LogActivityButton target … />: a button that opens it ("Log call / note").
 */

export type { LoggableKind };

/** Where the activity is logged. At least one id; a row's contact and organization are filled in on the server. */
export interface ActivityTarget {
  opportunityId?: string | null;
  contactId?: string | null;
  organizationId?: string | null;
}

/** What addActivityAction returns on success. */
export interface LoggedActivity {
  activity: ActivityView;
  /** "contacted" when a To contact row moved on because of this activity. */
  stageChanged: OpportunityStage | null;
}

/** How the dialog opens. */
export interface LogActivityOptions {
  target: ActivityTarget;
  /** Selected kind when it opens (default "call"). */
  kind?: LoggableKind;
  /** Preselected call outcome. */
  outcome?: CallOutcome | null;
  /** Who / what it is about, shown on top: "María López · Teatro Jovellanos". */
  subject?: string | null;
  /** Their number: shows a "Call" link in the dialog (to call again). */
  phone?: string | null;
  /** Prefilled note. */
  body?: string;
}

const PLACEHOLDERS: Record<LoggableKind, string> = {
  call: "What did you talk about?",
  whatsapp: "What did you send or receive?",
  meeting: "Where, who, what was agreed",
  email: "Which address, what it said",
  note: "Note",
};

/** The row's next step after these call outcomes: call them again. */
const CALL_AGAIN: (CallOutcome | null)[] = ["no_answer", "voicemail", "call_back"];
/** Next-step select: "" = keep the row's next step as is, NO_ACTION = clear it. */
const NO_ACTION = "__none";

const HINTS: Partial<Record<LoggableKind, string>> = {
  email: "For emails the CRM can't see (another account, a contact form, post). Gmail emails appear by themselves.",
  note: "A note does not count as contacting them.",
};

export function LogActivityDialog({
  open,
  ...props
}: LogActivityOptions & {
  open: boolean;
  onClose: () => void;
  /** Owner's timezone (env.timezone): "now" and the follow-up presets use it. */
  timezone: string;
  onLogged?: (result: LoggedActivity) => void;
}) {
  // Mounted only while open, so every opening starts from a clean form.
  return open ? <LogActivitySheet {...props} /> : null;
}

function LogActivitySheet({
  target,
  kind: initialKind = "call",
  outcome: initialOutcome = null,
  subject,
  phone,
  body: initialBody = "",
  timezone,
  onClose,
  onLogged,
}: LogActivityOptions & {
  timezone: string;
  onClose: () => void;
  onLogged?: (result: LoggedActivity) => void;
}) {
  const formId = useId();
  const [today] = useState(() => todayIn(timezone));
  const [when, setWhen] = useState(() => toDateTimeLocal(new Date(), timezone));
  const [kind, setKind] = useState<LoggableKind>(initialKind);
  const [outcome, setOutcome] = useState<CallOutcome | null>(initialKind === "call" ? initialOutcome : null);
  const [body, setBody] = useState(initialBody);
  // Follow-up typed by the owner; until then it follows the call outcome's preset.
  const [manual, setManual] = useState<{ followUpAt: string; nextStep: string } | null>(null);
  // The row's structured next step chosen by the owner; until then the outcome's ("Call" after No answer / Call back).
  const [manualAction, setManualAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasRow = Boolean(target.opportunityId);
  const canFollowUp = hasRow || Boolean(target.contactId);
  const preset = kind === "call" ? callFollowUpPreset(outcome, today) : null;
  const followUp = manual ?? preset ?? { followUpAt: "", nextStep: "" };
  const presetAction = hasRow && kind === "call" && CALL_AGAIN.includes(outcome) ? "call" : "";
  const action = manualAction ?? presetAction;
  const title = LOGGABLE_KINDS.find((k) => k.value === kind)?.title ?? "Log activity";
  const tel = telHref(phone);
  const dirty = body.trim() !== initialBody.trim() || manual !== null || manualAction !== null;

  const requestClose = useCallback(() => {
    if (pending) return;
    if (dirty && !window.confirm("Discard what you wrote?")) return;
    onClose();
  }, [pending, dirty, onClose]);

  function submit() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await addActivityAction({
          kind,
          outcome: kind === "call" ? outcome : null,
          body: body.trim() || null,
          occurredAt: when || null,
          opportunityId: target.opportunityId || null,
          contactId: target.contactId || null,
          organizationId: target.organizationId || null,
          followUpAt: canFollowUp && followUp.followUpAt ? followUp.followUpAt : null,
          nextStep: canFollowUp && followUp.nextStep.trim() ? followUp.nextStep.trim() : null,
          // Rows only; omitted = keep the row's next step.
          ...(hasRow && action ? { nextAction: action === NO_ACTION ? null : (action as NextAction) } : {}),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const { activity, stageChanged } = result;
        emitActivityChanged({
          opportunityId: activity.opportunityId,
          contactId: activity.contactId,
          organizationId: activity.organizationId,
        });
        onLogged?.({ activity, stageChanged });
        onClose();
      } catch {
        setError("Not saved. Check your connection and try again.");
      }
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <Sheet
      open
      onClose={requestClose}
      title={title}
      description={subject || undefined}
      primary={{ label: "Save", form: formId, pending }}
      footer={
        <>
          <Button variant="ghost" onClick={requestClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={onKeyDown}
        className="flex flex-col gap-5 md:gap-4"
        aria-busy={pending}
      >
        {tel ? (
          <a
            href={tel}
            className="-mt-1 inline-flex h-10 w-fit items-center gap-2 text-[15px] text-blue-600 active:opacity-60 md:-mt-1 md:h-auto md:text-sm md:hover:underline dark:text-blue-400"
          >
            <Phone className="size-4" strokeWidth={1.75} aria-hidden />
            Call {formatPhone(tel.slice(4))}
          </a>
        ) : null}

        <div role="group" aria-label="What happened" className="grid grid-cols-5 gap-1.5">
          {LOGGABLE_KINDS.map((k) => {
            const active = k.value === kind;
            return (
              <button
                key={k.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setKind(k.value);
                  if (k.value !== "call") setOutcome(null);
                }}
                className={cn(
                  "flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border bg-surface px-0.5 text-[12px] font-medium transition-colors md:h-12 md:rounded-lg md:text-[11px]",
                  active ? "border-fg/60 text-fg shadow-sm" : "border-border text-muted active:bg-surface-2 md:hover:text-fg",
                )}
              >
                <ActivityIcon kind={k.value} className={cn("size-5 md:size-4", active ? "text-fg" : "text-subtle")} />
                <span className="max-w-full truncate">{k.short}</span>
              </button>
            );
          })}
        </div>

        {kind === "call" ? (
          <div role="group" aria-labelledby={`${formId}-outcome`} className="flex flex-col gap-2">
            <span id={`${formId}-outcome`} className="text-xs font-medium text-muted">
              How did it go?
            </span>
            <div className="flex flex-wrap gap-2 md:gap-1.5">
              {CALL_OUTCOMES.map((o) => {
                const active = o.value === outcome;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setOutcome(active ? null : o.value)}
                    className={cn(
                      "inline-flex h-10 items-center rounded-full border px-4 text-[15px] transition-colors md:h-7 md:px-2.5 md:text-xs",
                      active
                        ? "border-accent bg-accent font-medium text-accent-fg"
                        : "border-border bg-surface text-fg active:bg-surface-2 md:hover:bg-surface-2",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <Field label={kind === "note" ? "Note" : "Notes"} htmlFor={`${formId}-body`} hint={HINTS[kind]}>
          <Textarea
            id={`${formId}-body`}
            rows={3}
            value={body}
            maxLength={20_000}
            placeholder={PLACEHOLDERS[kind]}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>

        <Field label="When" htmlFor={`${formId}-when`}>
          <Input
            id={`${formId}-when`}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="md:w-56"
          />
        </Field>

        {canFollowUp ? (
          <div role="group" aria-labelledby={`${formId}-follow`} className="flex flex-col gap-2">
            <div className="flex min-h-9 items-center justify-between gap-2 md:min-h-0">
              <span id={`${formId}-follow`} className="text-xs font-medium text-muted">
                {hasRow ? "Next step" : "Follow up"} <span className="font-normal text-subtle">(optional)</span>
              </span>
              {followUp.followUpAt || followUp.nextStep || action ? (
                <button
                  type="button"
                  onClick={() => {
                    setManual({ followUpAt: "", nextStep: "" });
                    setManualAction("");
                  }}
                  className="flex h-9 items-center text-[13px] text-muted active:opacity-60 md:h-auto md:text-xs md:hover:text-fg"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className={cn("flex flex-col gap-2 md:grid", hasRow ? "md:grid-cols-[minmax(0,1fr)_11rem]" : "md:grid-cols-[11rem_1fr]")}>
              {hasRow ? (
                <Select aria-label="Next step" value={action} onChange={(e) => setManualAction(e.target.value)} className={cn(!action && "text-subtle")}>
                  <option value="">Next step: keep as is</option>
                  <NextActionOptions />
                  <option value={NO_ACTION}>No next step</option>
                </Select>
              ) : null}
              <Input
                type="date"
                aria-label="Follow up on"
                value={followUp.followUpAt}
                onChange={(e) => setManual({ ...followUp, followUpAt: e.target.value })}
              />
              <Input
                aria-label={hasRow ? "Next step detail" : "Follow-up note"}
                placeholder={hasRow ? "Detail (optional)" : "Follow-up note"}
                value={followUp.nextStep}
                maxLength={300}
                onChange={(e) => setManual({ ...followUp, nextStep: e.target.value })}
                className={hasRow ? "md:col-span-2" : undefined}
              />
            </div>
            <p className="text-xs text-subtle">
              {(!manual && preset) || (manualAction === null && presetAction)
                ? "Suggested for this outcome. Change it or clear it."
                : hasRow
                  ? "Sets this row's next step and when it is due."
                  : "Sets the contact's follow-up (the note is saved with a date)."}
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

/**
 * One log dialog for a list (the sheet's rows, Today): `open({ target, kind,
 * subject, phone })` from any row, render `dialog` once anywhere (it is a
 * portal).
 */
export function useActivityLogger({
  timezone,
  onLogged,
}: {
  timezone: string;
  onLogged?: (result: LoggedActivity, options: LogActivityOptions) => void;
}): { open: (options: LogActivityOptions) => void; close: () => void; isOpen: boolean; dialog: ReactNode } {
  const [request, setRequest] = useState<(LogActivityOptions & { key: number }) | null>(null);
  const open = useCallback((options: LogActivityOptions) => setRequest((prev) => ({ ...options, key: (prev?.key ?? 0) + 1 })), []);
  const close = useCallback(() => setRequest(null), []);
  const dialog = request ? (
    <LogActivityDialog
      key={request.key}
      open
      onClose={close}
      timezone={timezone}
      target={request.target}
      kind={request.kind}
      outcome={request.outcome}
      subject={request.subject}
      phone={request.phone}
      body={request.body}
      onLogged={onLogged ? (result) => onLogged(result, request) : undefined}
    />
  ) : null;
  return { open, close, isOpen: request !== null, dialog };
}

/** A button that opens the log dialog ("Log call / note" on the contact page). */
export function LogActivityButton({
  target,
  timezone,
  kind = "call",
  subject,
  phone,
  label = "Log call / note",
  variant = "secondary",
  size = "md",
  icon = true,
  className,
  onLogged,
}: Omit<LogActivityOptions, "outcome" | "body"> & {
  timezone: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show the kind's icon before the label. */
  icon?: boolean;
  className?: ComponentProps<"button">["className"];
  onLogged?: (result: LoggedActivity) => void;
}) {
  const logger = useActivityLogger({ timezone, onLogged: onLogged ? (result) => onLogged(result) : undefined });
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => logger.open({ target, kind, subject, phone })}>
        {icon ? <ActivityIcon kind={kind} /> : null}
        {label}
      </Button>
      {logger.dialog}
    </>
  );
}
