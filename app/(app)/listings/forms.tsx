"use client";

import { useRef, useState } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import {
  DEFAULT_EVENT_TIME_ZONE,
  LISTING_COSTS,
  LISTING_METHODS,
  SUBMISSION_STATUS_HINT,
  SUBMISSION_STATUSES,
  type SubmissionStatus,
} from "@/lib/listings/constants";
import type { ListingEvent, ListingPlatform, ListingSubmission } from "@/lib/queries/listings";
import { cn } from "@/lib/utils";
import { ActionForm, FormSubmit } from "../_components/action-form";
import { FormActions } from "../_components/ui";
import { saveEventAction, savePlatformAction, saveSubmissionAction, setStatusAction } from "./actions";

export const STATUS_STYLE: Record<SubmissionStatus, string> = {
  todo: "bg-surface-2 text-muted",
  sent: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  received: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  published: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  blocked: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  skipped: "bg-surface-2 text-subtle",
};

/** The status of a platform for this concert: picking another saves it at once. */
export function StatusPicker({ eventId, platformId, status }: { eventId: string; platformId: string; status: SubmissionStatus }) {
  const form = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(status);
  return (
    <form ref={form} action={setStatusAction.bind(null, eventId, platformId)}>
      <select
        name="status"
        value={value}
        aria-label="Status for this concert"
        title={SUBMISSION_STATUS_HINT[value]}
        onChange={(e) => {
          setValue(e.target.value as SubmissionStatus);
          form.current?.requestSubmit();
        }}
        className={cn(
          "h-9 rounded-full border-0 py-0 pl-3 pr-7 text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-ring/30 md:h-7 md:text-xs",
          STATUS_STYLE[value],
        )}
      >
        {SUBMISSION_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </form>
  );
}

/** Everything about this concert on this platform: date, who sent it, links, notes. */
export function SubmissionForm({
  eventId,
  platformId,
  submission,
}: {
  eventId: string;
  platformId: string;
  submission: ListingSubmission | null;
}) {
  const p = `s-${platformId}`;
  return (
    <ActionForm action={saveSubmissionAction.bind(null, eventId, platformId)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Status" htmlFor={`${p}-status`}>
          <Select id={`${p}-status`} name="status" defaultValue={submission?.status ?? "todo"}>
            {SUBMISSION_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sent on" htmlFor={`${p}-sent`}>
          <Input id={`${p}-sent`} name="sentAt" type="date" defaultValue={submission?.sentAt ?? ""} />
        </Field>
        <Field label="Sent by" htmlFor={`${p}-by`}>
          <Input id={`${p}-by`} name="sentBy" defaultValue={submission?.sentBy ?? ""} placeholder="Guillermo, ChatGPT…" maxLength={100} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Confirmation link" htmlFor={`${p}-conf`}>
          <Input id={`${p}-conf`} name="confirmationUrl" inputMode="url" autoCapitalize="off" defaultValue={submission?.confirmationUrl ?? ""} placeholder="https://" />
        </Field>
        <Field label="Public listing" htmlFor={`${p}-pub`}>
          <Input id={`${p}-pub`} name="publicUrl" inputMode="url" autoCapitalize="off" defaultValue={submission?.publicUrl ?? ""} placeholder="https://" />
        </Field>
      </div>
      <Field label="Notes for this concert" htmlFor={`${p}-notes`}>
        <Textarea id={`${p}-notes`} name="notes" rows={2} defaultValue={submission?.notes ?? ""} maxLength={4000} />
      </Field>
      <FormActions>
        <FormSubmit pendingLabel="Saving…">Save</FormSubmit>
      </FormActions>
    </ActionForm>
  );
}

/** Add a platform, or edit one (how to submit, login, cost…). */
export function PlatformForm({ platform }: { platform?: ListingPlatform }) {
  const p = platform ? `p-${platform.id}` : "p-new";
  return (
    <ActionForm action={savePlatformAction.bind(null, platform?.id ?? null)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${p}-name`}>
          <Input id={`${p}-name`} name="name" required maxLength={200} defaultValue={platform?.name ?? ""} autoComplete="off" />
        </Field>
        <Field label="How to submit" htmlFor={`${p}-method`}>
          <Select id={`${p}-method`} name="method" defaultValue={platform?.method ?? "form"}>
            {LISTING_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Submission page" htmlFor={`${p}-submit`} hint="The form, or the page to log in and post.">
          <Input id={`${p}-submit`} name="submitUrl" inputMode="url" autoCapitalize="off" placeholder="https://" defaultValue={platform?.submitUrl ?? ""} />
        </Field>
        <Field label="Email" htmlFor={`${p}-email`} hint="When they take it by email.">
          <Input id={`${p}-email`} name="email" type="email" inputMode="email" autoCapitalize="off" defaultValue={platform?.email ?? ""} />
        </Field>
        <Field label="Website" htmlFor={`${p}-web`}>
          <Input id={`${p}-web`} name="website" inputMode="url" autoCapitalize="off" placeholder="https://" defaultValue={platform?.website ?? ""} />
        </Field>
        <Field label="Account it needs" htmlFor={`${p}-login`} hint="Which login (an email, “Google”, “Facebook”). Never a password.">
          <div className="flex items-center gap-2">
            <label className="flex shrink-0 items-center gap-1.5 text-sm text-muted">
              <Checkbox name="loginRequired" defaultChecked={platform?.loginRequired ?? false} />
              Login
            </label>
            <Input id={`${p}-login`} name="loginAccount" maxLength={300} defaultValue={platform?.loginAccount ?? ""} placeholder="guillermo@creartbox.nyc" />
          </div>
        </Field>
        <Field label="Cost" htmlFor={`${p}-cost`}>
          <div className="flex gap-2">
            <Select id={`${p}-cost`} name="cost" defaultValue={platform?.cost ?? "unknown"} className="w-36 shrink-0">
              {LISTING_COSTS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            <Input name="costNote" maxLength={300} defaultValue={platform?.costNote ?? ""} placeholder="25 USD per concert" aria-label="Cost details" />
          </div>
        </Field>
        <Field label="Lead time (days)" htmlFor={`${p}-lead`}>
          <Input id={`${p}-lead`} name="leadDays" inputMode="numeric" maxLength={3} defaultValue={platform?.leadDays ?? ""} />
        </Field>
      </div>
      <Field label="Audience" htmlFor={`${p}-aud`}>
        <Input id={`${p}-aud`} name="audience" maxLength={300} defaultValue={platform?.audience ?? ""} placeholder="Classical / new music / local discovery…" />
      </Field>
      <Field label="Instructions" htmlFor={`${p}-instr`} hint="What the form asks, requirements, what to say. The brief for ChatGPT includes it.">
        <Textarea id={`${p}-instr`} name="instructions" rows={3} maxLength={4000} defaultValue={platform?.instructions ?? ""} />
      </Field>
      <Field label="Notes" htmlFor={`${p}-notes`}>
        <Textarea id={`${p}-notes`} name="notes" rows={2} maxLength={4000} defaultValue={platform?.notes ?? ""} />
      </Field>
      {platform ? (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="hidden" name="activeField" value="1" />
          <Checkbox name="active" defaultChecked={platform.active} />
          Active (unchecked: kept for reference, left out of the brief)
        </label>
      ) : null}
      <FormActions>
        <FormSubmit pendingLabel="Saving…">{platform ? "Save platform" : "Add platform"}</FormSubmit>
      </FormActions>
    </ActionForm>
  );
}

function localParts(event: ListingEvent | undefined): { date: string; time: string } {
  if (!event) return { date: "", time: "19:30" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: event.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(event.startsAt);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** A concert to promote: the facts every listing asks for. */
export function EventForm({ event }: { event?: ListingEvent }) {
  const p = event ? `e-${event.id}` : "e-new";
  const { date, time } = localParts(event);
  return (
    <ActionForm action={saveEventAction.bind(null, event?.id ?? null)} className="flex flex-col gap-3">
      <input type="hidden" name="timeZone" value={event?.timeZone ?? DEFAULT_EVENT_TIME_ZONE} />
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_7rem]">
        <Field label="Concert" htmlFor={`${p}-title`}>
          <Input id={`${p}-title`} name="title" required maxLength={300} defaultValue={event?.title ?? ""} />
        </Field>
        <Field label="Date" htmlFor={`${p}-date`}>
          <Input id={`${p}-date`} name="date" type="date" required defaultValue={date} />
        </Field>
        <Field label="Time (NY)" htmlFor={`${p}-time`}>
          <Input id={`${p}-time`} name="time" type="time" required defaultValue={time} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Venue" htmlFor={`${p}-venue`}>
          <Input id={`${p}-venue`} name="venue" maxLength={300} defaultValue={event?.venue ?? ""} />
        </Field>
        <Field label="Address" htmlFor={`${p}-address`}>
          <Input id={`${p}-address`} name="address" maxLength={500} defaultValue={event?.address ?? ""} />
        </Field>
        <Field label="Prices" htmlFor={`${p}-prices`}>
          <Input id={`${p}-prices`} name="prices" maxLength={300} defaultValue={event?.prices ?? ""} placeholder="35 USD general, 70 USD premium" />
        </Field>
        <Field label="Tickets" htmlFor={`${p}-tickets`}>
          <Input id={`${p}-tickets`} name="ticketUrl" inputMode="url" autoCapitalize="off" placeholder="https://" defaultValue={event?.ticketUrl ?? ""} />
        </Field>
        <Field label="Info page" htmlFor={`${p}-info`}>
          <Input id={`${p}-info`} name="infoUrl" inputMode="url" autoCapitalize="off" placeholder="https://" defaultValue={event?.infoUrl ?? ""} />
        </Field>
        <Field label="Official image" htmlFor={`${p}-image`}>
          <Input id={`${p}-image`} name="imageUrl" inputMode="url" autoCapitalize="off" placeholder="https://" defaultValue={event?.imageUrl ?? ""} />
        </Field>
      </div>
      <Field label="Description" htmlFor={`${p}-desc`} hint="Program, performers, length: what the forms ask for.">
        <Textarea id={`${p}-desc`} name="description" rows={5} maxLength={6000} defaultValue={event?.description ?? ""} />
      </Field>
      <Field label="Notes" htmlFor={`${p}-notes`}>
        <Textarea id={`${p}-notes`} name="notes" rows={2} maxLength={4000} defaultValue={event?.notes ?? ""} />
      </Field>
      <FormActions>
        <FormSubmit pendingLabel="Saving…">{event ? "Save concert" : "Add concert"}</FormSubmit>
      </FormActions>
    </ActionForm>
  );
}

/** Copies the brief (concert facts + platforms still to do) for ChatGPT or an assistant. */
export function CopyBrief({ text, pending }: { text: string; pending: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          setCopied(false);
        }
      }}
      title="The concert's facts and how to submit to every platform still to do, ready to paste into ChatGPT"
    >
      {copied ? <Check className="size-4" aria-hidden /> : <ClipboardCopy className="size-4" aria-hidden />}
      {copied ? "Copied" : `Copy brief for ChatGPT (${pending})`}
    </button>
  );
}
