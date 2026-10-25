"use client";

import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, ClipboardCopy, ExternalLink } from "lucide-react";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import {
  DEFAULT_EVENT_TIME_ZONE,
  LISTING_COSTS,
  LISTING_METHODS,
  PLATFORM_KINDS,
  PLATFORM_TIERS,
  SUBMISSION_STATUS_HINT,
  SUBMISSION_STATUSES,
  type SubmissionStatus,
} from "@/lib/listings/constants";
import type { ListingEvent, ListingPlatform, ListingSubmission } from "@/lib/queries/listings";
import { cn } from "@/lib/utils";
import { ActionForm, FormSubmit } from "../_components/action-form";
import { FormActions } from "../_components/ui";
import { InsetGroup } from "./stage";
import { saveEventAction, savePlatformAction, saveSubmissionAction, setStatusAction } from "./actions";

const STATUS_TEXT: Record<SubmissionStatus, string> = {
  todo: "text-amber-600 dark:text-amber-400",
  blocked: "text-amber-700 dark:text-amber-300",
  sent: "text-blue-600 dark:text-blue-400",
  received: "text-blue-600 dark:text-blue-400",
  published: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-red-600 dark:text-red-400",
  skipped: "text-subtle",
};

/**
 * The status as the trailing value of a list row, iOS style: colored text
 * over a transparent native select, so a tap opens the system picker and
 * the choice saves at once.
 */
export function StatusCell({ eventId, platformId, status }: { eventId: string; platformId: string; status: SubmissionStatus }) {
  const form = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(status);
  const label = SUBMISSION_STATUSES.find((s) => s.value === value)?.label ?? value;
  return (
    <form ref={form} action={setStatusAction.bind(null, eventId, platformId)} className="relative flex shrink-0 items-center self-stretch">
      <span className={cn("pointer-events-none flex items-center gap-0.5 pl-2 text-[15px] md:text-sm", STATUS_TEXT[value])}>
        {label}
        <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden />
      </span>
      <select
        name="status"
        value={value}
        aria-label="Status for this concert"
        title={SUBMISSION_STATUS_HINT[value]}
        onChange={(e) => {
          setValue(e.target.value as SubmissionStatus);
          form.current?.requestSubmit();
        }}
        className="absolute inset-0 w-full cursor-pointer appearance-none opacity-0"
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

const cellInput =
  "min-w-0 flex-1 bg-transparent text-right text-[17px] text-muted placeholder:text-subtle/60 focus:text-fg focus:outline-none md:text-sm";

/** One settings-style row: label on the left, the value typed on the right. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      <label className="flex min-h-[52px] items-center gap-3 px-4 md:min-h-11">
        <span className="shrink-0 text-[17px] text-fg md:text-sm">{label}</span>
        {children}
      </label>
    </li>
  );
}

/** A link field, with a button to open what is already saved. */
function UrlCell({ label, name, value }: { label: string; name: string; value: string | null }) {
  return (
    <Cell label={label}>
      <input name={name} inputMode="url" autoCapitalize="off" autoCorrect="off" defaultValue={value ?? ""} placeholder="https://" className={cellInput} />
      {value ? (
        <a href={value} target="_blank" rel="noreferrer noopener" aria-label={`Open ${label.toLowerCase()}`} className="-mr-1 shrink-0 p-1 text-blue-600 dark:text-blue-400">
          <ExternalLink className="size-4" aria-hidden />
        </a>
      ) : null}
    </Cell>
  );
}

/**
 * This concert on this site, as grouped rows: tickets (partners), when and
 * by whom it went out, the confirmation and public links, notes. The status
 * has its own row above, so this form leaves it as it is.
 */
export function SubmissionForm({
  eventId,
  platformId,
  submission,
  partner = false,
}: {
  eventId: string;
  platformId: string;
  submission: ListingSubmission | null;
  /** Ticketing partner: tickets offered, member price, tickets taken. */
  partner?: boolean;
}) {
  const s = submission;
  return (
    <ActionForm action={saveSubmissionAction.bind(null, eventId, platformId)} className="flex flex-col gap-7" messageClassName="px-4">
      {partner ? (
        <InsetGroup title="Tickets">
          <Cell label="Offered">
            <input name="ticketsOffered" inputMode="numeric" maxLength={5} defaultValue={s?.ticketsOffered ?? ""} placeholder="0" className={cellInput} />
          </Cell>
          <Cell label="Members pay">
            <input name="memberPrice" maxLength={100} defaultValue={s?.memberPrice ?? ""} placeholder="Free, 25 USD" className={cellInput} />
          </Cell>
          <Cell label="Taken">
            <input name="ticketsTaken" inputMode="numeric" maxLength={5} defaultValue={s?.ticketsTaken ?? ""} placeholder="0" className={cellInput} />
          </Cell>
        </InsetGroup>
      ) : (
        <>
          <input type="hidden" name="ticketsOffered" value={s?.ticketsOffered ?? ""} />
          <input type="hidden" name="ticketsTaken" value={s?.ticketsTaken ?? ""} />
          <input type="hidden" name="memberPrice" value={s?.memberPrice ?? ""} />
        </>
      )}
      <InsetGroup title="Sent" footer="The links let ChatGPT check later whether it was published, and follow up.">
        <Cell label="On">
          <input name="sentAt" type="date" defaultValue={s?.sentAt ?? ""} className={cn(cellInput, "appearance-none")} />
        </Cell>
        <Cell label="By">
          <input name="sentBy" maxLength={100} defaultValue={s?.sentBy ?? ""} placeholder="Guillermo, ChatGPT" className={cellInput} />
        </Cell>
        <UrlCell label="Confirmation" name="confirmationUrl" value={s?.confirmationUrl ?? null} />
        <UrlCell label="Public listing" name="publicUrl" value={s?.publicUrl ?? null} />
      </InsetGroup>
      <InsetGroup title="Why it is pending" footer="ChatGPT writes here (pending_reason) what blocks the submission and what it needs from you.">
        <li>
          <textarea
            name="pendingReason"
            rows={2}
            maxLength={2000}
            defaultValue={s?.pendingReason ?? ""}
            aria-label="Why it is pending"
            placeholder="Captcha, login, they ask for payment…"
            className="block min-h-20 w-full resize-none bg-transparent px-4 py-3 text-[17px] leading-relaxed text-fg placeholder:text-subtle/60 [field-sizing:content] focus:outline-none md:text-sm"
          />
        </li>
      </InsetGroup>
      <InsetGroup title="Notes for this concert">
        <li>
          <textarea
            name="notes"
            rows={4}
            maxLength={4000}
            defaultValue={s?.notes ?? ""}
            aria-label="Notes for this concert"
            placeholder="What they answered, what is missing…"
            className="block min-h-28 w-full resize-none bg-transparent px-4 py-3 [field-sizing:content] text-[17px] leading-relaxed text-fg placeholder:text-subtle/60 focus:outline-none md:text-sm"
          />
        </li>
      </InsetGroup>
      <FormSubmit pendingLabel="Saving…" className="h-[52px] w-full rounded-xl text-[17px] md:h-9 md:w-auto md:self-start md:rounded-md md:text-sm">
        Save
      </FormSubmit>
    </ActionForm>
  );
}

/** Add a platform, or edit one (how to submit, login, cost…). */
export function PlatformForm({ platform, id, onDone }: { platform?: ListingPlatform; id?: string; onDone?: () => void }) {
  const p = platform ? `p-${platform.id}` : "p-new";
  return (
    <ActionForm id={id} onDone={onDone} action={savePlatformAction.bind(null, platform?.id ?? null)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${p}-name`}>
          <Input id={`${p}-name`} name="name" required maxLength={200} defaultValue={platform?.name ?? ""} autoComplete="off" />
        </Field>
        <Field label="Type" htmlFor={`${p}-kind`}>
          <Select id={`${p}-kind`} name="kind" defaultValue={platform?.kind ?? "calendar"}>
            {PLATFORM_KINDS.map((k) => (
              <option key={k.value} value={k.value} title={k.hint}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Routine" htmlFor={`${p}-tier`} hint="Every concert: part of the checklist each time.">
          <Select id={`${p}-tier`} name="tier" defaultValue={platform?.tier ?? "sometimes"}>
            {PLATFORM_TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
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
      <Field label="What they ask for" htmlFor={`${p}-fields`} hint="The form's fields or what the email must include: image size, word limits, categories…">
        <Textarea id={`${p}-fields`} name="fields" rows={2} maxLength={2000} defaultValue={platform?.fields ?? ""} />
      </Field>
      <Field label="Instructions" htmlFor={`${p}-instr`} hint="What the form asks, requirements, what to say. The brief for ChatGPT includes it.">
        <Textarea id={`${p}-instr`} name="instructions" rows={3} maxLength={4000} defaultValue={platform?.instructions ?? ""} />
      </Field>
      <Field label="Notes" htmlFor={`${p}-notes`}>
        <Textarea id={`${p}-notes`} name="notes" rows={2} maxLength={4000} defaultValue={platform?.notes ?? ""} />
      </Field>
      <Field label="Their emails" htmlFor={`${p}-match`} hint="Addresses or domains we talk to them from (molly@piptix.com, tdf.org): their emails show on the card.">
        <Input id={`${p}-match`} name="emailMatch" autoCapitalize="off" defaultValue={platform?.emailMatch.join(", ") ?? ""} />
      </Field>
      {/* In a sheet, phones save from its header. */}
      <FormActions className={id ? "hidden md:flex" : undefined}>
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
export function EventForm({ event, id, onDone }: { event?: ListingEvent; id?: string; onDone?: () => void }) {
  const p = event ? `e-${event.id}` : "e-new";
  const { date, time } = localParts(event);
  return (
    <ActionForm id={id} onDone={onDone} action={saveEventAction.bind(null, event?.id ?? null)} className="flex flex-col gap-3">
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
      <FormActions className={id ? "hidden md:flex" : undefined}>
        <FormSubmit pendingLabel="Saving…">{event ? "Save concert" : "Add concert"}</FormSubmit>
      </FormActions>
    </ActionForm>
  );
}

/** Copies the brief (concert facts + platforms still to do) for ChatGPT or an assistant. */
export function CopyBrief({ text, pending, className }: { text: string; pending: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className ?? buttonClass("secondary", "sm")}
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
