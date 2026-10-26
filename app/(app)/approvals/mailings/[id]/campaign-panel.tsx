"use client";

import Link from "next/link";
import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { celebrateSend, flourishOrigin } from "@/components/brand/send-flourish";
import { VelaLoader } from "@/components/brand/vela-logo";
import { CircleCheck, Loader2, Pause, Play, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/layout";
import { Sheet } from "@/components/ui/sheet";
import { campaignSize, dailyCapBinds, hourLabel, planSentence, roundUpToTick, timeZoneCity, whenPhrase } from "@/lib/campaigns/format";
import { estimateSends, minGapMs, validateCampaignSettings } from "@/lib/campaigns/schedule";
import { ACCOUNT_DAILY_SEND_CAP, CAMPAIGN_LIMITS, type CampaignSettings, type CampaignSummary } from "@/lib/campaigns/types";
import { cn } from "@/lib/utils";
import {
  cancelCampaignAction,
  discardCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  startCampaignAction,
  updateCampaignSettingsAction,
} from "../../actions";
import { ProgressBar } from "../../campaign-ui";

/**
 * The campaign's control panel: where it stands, the plan in plain words,
 * the sending settings, and the one approval button ("Approve N emails and
 * start sending", confirmed in a sheet). While sending: progress, next send,
 * Pause / Resume / Cancel remaining. Nothing here sends an email: approving
 * queues them and the cron sends them gradually.
 */

interface FormValues {
  name: string;
  perHour: string;
  dailyCap: string;
  windowStart: string;
  windowEnd: string;
  weekdaysOnly: boolean;
  timezone: string;
}

function valuesOf(c: CampaignSummary): FormValues {
  return {
    name: c.name,
    perHour: String(c.perHour),
    dailyCap: String(c.dailyCap),
    windowStart: String(c.windowStart),
    windowEnd: String(c.windowEnd),
    weekdaysOnly: c.weekdaysOnly,
    timezone: c.timezone,
  };
}

function settingsOf(c: CampaignSummary): CampaignSettings {
  return {
    perHour: c.perHour,
    dailyCap: c.dailyCap,
    windowStart: c.windowStart,
    windowEnd: c.windowEnd,
    weekdaysOnly: c.weekdaysOnly,
    timezone: c.timezone,
  };
}

const toInt = (value: string): number => (/^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN);

function parse(values: FormValues): Partial<CampaignSettings> {
  return {
    perHour: toInt(values.perHour),
    dailyCap: toInt(values.dailyCap),
    windowStart: toInt(values.windowStart),
    windowEnd: toInt(values.windowEnd),
    weekdaysOnly: values.weekdaysOnly,
    timezone: values.timezone,
  };
}

function gapHint(perHour: number): string {
  if (!Number.isFinite(perHour) || perHour < 1) return "";
  const minutes = minGapMs(perHour) / 60_000;
  const text = minutes >= 60 ? "an hour" : `${Math.round(minutes)} minutes`;
  return `About one every ${text}, with a little random variation so they don't look automated.`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Confirm = "approve" | "cancel" | "discard" | null;

export function CampaignPanel({
  campaign: c,
  held,
  ownerTimezone,
  now: serverNow,
  timezones,
}: {
  campaign: CampaignSummary;
  /** Emails held back by the sender (proposed again). */
  held: number;
  ownerTimezone: string;
  /** The server's clock when the page rendered (ISO), so the first render matches. */
  now: string;
  timezones: { value: string; label: string }[];
}) {
  const router = useRouter();
  const formId = useId();
  const [edits, setEdits] = useState<Partial<FormValues>>({});
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date(serverNow));

  // Estimates move with the clock while the page stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const base = valuesOf(c);
  const values: FormValues = { ...base, ...edits };
  const dirty = (Object.keys(edits) as (keyof FormValues)[]).some((k) => edits[k] !== base[k]);
  const checked = validateCampaignSettings(parse(values), settingsOf(c));
  const settings = checked.ok ? checked.settings : settingsOf(c);
  const nameError = !values.name.trim() ? "Give the mailing a name." : null;
  const formError = checked.ok ? nameError : checked.error;

  const size = campaignSize(c.counts);
  // Waiting for the owner; the held-back ones are re-approved one by one ("Queue again"), not with the campaign.
  const unsent = c.counts.proposed + c.counts.failed;
  const approvable = Math.max(0, unsent - held);
  // A paused campaign with emails still queued is resumed instead (its waiting ones stay as they are).
  const canApprove = c.status !== "running" && !(c.status === "paused" && c.counts.queued > 0) && approvable > 0;
  const started = c.status === "running" || c.status === "paused";
  const count = canApprove ? approvable : c.remaining;

  const estimate = estimateSends(settings, {
    count,
    now,
    lastSentAt: started && c.lastSentAt ? new Date(c.lastSentAt) : null,
    sentToday: c.sentToday,
  });
  const plan = planSentence({
    count,
    accountEmail: c.accountEmail,
    settings,
    next: estimate.next,
    finish: estimate.finish,
    now,
    ownerTimezone,
    started: started && c.counts.sent > 0,
  });

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setEdits((e) => ({ ...e, [key]: value }));
    setMessage(null);
  };

  /** Run one campaign action; the page refreshes from the server afterwards. */
  const run = (label: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string, after?: () => void) => {
    setRunning(label);
    setMessage(null);
    startTransition(async () => {
      try {
        const outcome = await action();
        if (!outcome.ok) {
          setMessage({ tone: "error", text: outcome.error });
          return;
        }
        setEdits({});
        setConfirm(null);
        if (success) setMessage({ tone: "success", text: success });
        after?.();
      } catch {
        setMessage({ tone: "error", text: "Something went wrong. Check your connection and try again." });
      } finally {
        setRunning(null);
      }
    });
  };

  const saveSettings = () => {
    if (formError || !checked.ok) return;
    run("save", () => updateCampaignSettingsAction(c.id, { ...checked.settings, name: values.name.trim() }), "Settings saved.");
  };

  const approve = () => {
    if (formError || !checked.ok) return;
    // Where the "sent" flourish starts: the confirm button, when the browser focused it.
    const origin = flourishOrigin(document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
    const next = estimate.next ? whenPhrase(roundUpToTick(estimate.next), settings.timezone, now) : null;
    run(
      "approve",
      async () => {
        if (values.name.trim() !== c.name) {
          const renamed = await updateCampaignSettingsAction(c.id, { name: values.name.trim() });
          if (!renamed.ok) return renamed;
        }
        return startCampaignAction(c.id, checked.settings);
      },
      `Approved. ${plural(approvable, "email")} queued${next ? ` — the first one goes out ${next}` : ""}.`,
      () => celebrateSend(origin),
    );
  };

  const busy = pending || running !== null;
  const reconnect = c.accountStatus !== "active" && c.status !== "done" && c.status !== "cancelled";

  // ---- The primary action (fixed above the tab bar on phones) ----
  let primary: ReactNode = null;
  if (canApprove) {
    primary = (
      <Button
        variant="primary"
        className="w-full md:w-auto border-red-600 bg-red-600 text-white hover:bg-red-700 dark:border-red-700 dark:bg-red-700"
        disabled={busy || Boolean(formError) || c.accountStatus !== "active"}
        onClick={() => setConfirm("approve")}
      >
        <ShieldCheck className="size-4" strokeWidth={2} />
        Approve {plural(approvable, "email")} and start sending
      </Button>
    );
  } else if (c.status === "running") {
    primary = (
      <Button className="w-full md:w-auto" disabled={busy} onClick={() => run("pause", () => pauseCampaignAction(c.id), "Paused. Nothing more is sent until you resume.")}>
        {running === "pause" ? <Loader2 className="size-4 animate-spin" /> : <Pause className="size-4" strokeWidth={2} />}
        Pause sending
      </Button>
    );
  } else if (c.status === "paused") {
    primary = (
      <Button
        variant="primary"
        className="w-full md:w-auto"
        disabled={busy || c.accountStatus !== "active"}
        onClick={() => run("resume", () => resumeCampaignAction(c.id), "Resumed.")}
      >
        {running === "resume" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" strokeWidth={2} />}
        Resume sending
      </Button>
    );
  }

  const secondary: ReactNode[] = [];
  if (c.status === "running" || c.status === "paused") {
    secondary.push(
      <Button key="cancel" variant="danger" disabled={busy || c.counts.queued === 0} onClick={() => setConfirm("cancel")}>
        <X className="size-4" strokeWidth={2} /> Cancel remaining
      </Button>,
    );
  }
  if ((c.status === "draft" || c.status === "cancelled" || c.status === "done") && unsent > 0) {
    secondary.push(
      <Button key="discard" variant="danger" disabled={busy} onClick={() => setConfirm("discard")}>
        <Trash2 className="size-4" strokeWidth={1.75} /> Discard {unsent === 1 ? "it" : `all ${unsent}`}
      </Button>,
    );
  }

  return (
    <div className="flex flex-col gap-6 md:gap-5">
      <StatusBlock campaign={c} held={held} plan={plan} size={size} approvable={approvable} waiting={unsent} now={now} />

      {reconnect && !(c.status === "paused" && c.error) ? (
        <Notice tone="warning">
          {c.accountEmail} must be reconnected before this campaign can send.{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            Open Settings
          </Link>
        </Notice>
      ) : null}

      {message && !confirm ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {/* Sending settings */}
      <section aria-labelledby={`${formId}-title`}>
        <h2 id={`${formId}-title`} className="mb-1.5 px-4 text-[13px] uppercase tracking-wide text-subtle md:mb-2 md:px-0 md:text-xs md:font-medium">
          How to send
        </h2>
        <form
          id={`${formId}-form`}
          onSubmit={(e) => {
            e.preventDefault();
            saveSettings();
          }}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:gap-3 md:rounded-lg"
        >
          <Field label="Mailing name" htmlFor={`${formId}-name`}>
            <Input id={`${formId}-name`} value={values.name} maxLength={200} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emails per hour" htmlFor={`${formId}-per-hour`}>
              <Input
                id={`${formId}-per-hour`}
                type="number"
                inputMode="numeric"
                min={CAMPAIGN_LIMITS.perHour.min}
                max={CAMPAIGN_LIMITS.perHour.max}
                value={values.perHour}
                onChange={(e) => set("perHour", e.target.value)}
              />
            </Field>
            <Field label="Daily maximum" htmlFor={`${formId}-daily`}>
              <Input
                id={`${formId}-daily`}
                type="number"
                inputMode="numeric"
                min={CAMPAIGN_LIMITS.dailyCap.min}
                max={CAMPAIGN_LIMITS.dailyCap.max}
                value={values.dailyCap}
                onChange={(e) => set("dailyCap", e.target.value)}
              />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-subtle md:-mt-1.5">
            {gapHint(toInt(values.perHour))}
            {toInt(values.dailyCap) > ACCOUNT_DAILY_SEND_CAP
              ? ` Gmail safety limit: at most ${ACCOUNT_DAILY_SEND_CAP} mailing emails a day from one account.`
              : checked.ok && dailyCapBinds(checked.settings)
                ? ` The daily maximum stops it at ${checked.settings.dailyCap} a day.`
                : ""}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start sending at" htmlFor={`${formId}-from`}>
              <Select id={`${formId}-from`} value={values.windowStart} onChange={(e) => set("windowStart", e.target.value)}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Stop at" htmlFor={`${formId}-to`}>
              <Select id={`${formId}-to`} value={values.windowEnd} onChange={(e) => set("windowEnd", e.target.value)}>
                {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Time zone of the sending hours" htmlFor={`${formId}-tz`} hint="Use your recipients' time zone, so emails arrive during their working day.">
            <Select id={`${formId}-tz`} value={values.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {timezones.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 md:min-h-0">
            <Checkbox checked={values.weekdaysOnly} onChange={(e) => set("weekdaysOnly", e.target.checked)} />
            <span className="text-[15px] text-fg md:text-sm">
              Weekdays only <span className="text-muted">(Monday–Friday)</span>
            </span>
          </label>

          {formError ? <p className="text-sm text-danger">{formError}</p> : null}

          {dirty ? (
            <div className="flex flex-col gap-2 border-t border-border pt-3 md:flex-row md:items-center">
              <p className="min-w-0 flex-1 text-[13px] text-muted md:text-xs">
                {canApprove ? "These settings are saved when you approve, or save them now." : "Saved settings apply from the next send."}
              </p>
              <div className="grid grid-cols-2 gap-2 md:flex">
                <Button variant="ghost" disabled={busy} onClick={() => setEdits({})}>
                  Undo
                </Button>
                <Button type="submit" disabled={busy || Boolean(formError)}>
                  {running === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save settings
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      </section>

      {/* Actions: the primary one sits above the tab bar on phones. */}
      {primary || secondary.length ? (
        <section aria-label="Mailing actions" className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          {primary ? (
            <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+53px)] z-30 border-t border-border bg-bg/90 px-4 py-2 backdrop-blur-xl md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
              {primary}
            </div>
          ) : null}
          {secondary.length ? <div className="grid gap-2 md:flex">{secondary}</div> : null}
        </section>
      ) : null}
      {/* Room for the fixed bar on phones. */}
      {primary ? <div aria-hidden className="h-12 md:hidden" /> : null}

      <ApproveSheet
        open={confirm === "approve"}
        onClose={() => setConfirm(null)}
        onConfirm={approve}
        pending={running === "approve"}
        count={approvable}
        held={held}
        plan={plan}
        accountEmail={c.accountEmail}
        error={confirm === "approve" && message?.tone === "error" ? message.text : null}
      />

      <Sheet
        open={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        title="Cancel the remaining emails?"
        primary={{ label: "Cancel them", onClick: () => run("cancel", () => cancelCampaignAction(c.id), "Cancelled. The emails not sent went back to waiting for your approval."), pending: running === "cancel" }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
              Keep sending
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => run("cancel", () => cancelCampaignAction(c.id), "Cancelled. The emails not sent went back to waiting for your approval.")}
            >
              {running === "cancel" ? <Loader2 className="size-4 animate-spin" /> : null}
              Cancel remaining
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[15px] text-fg md:text-sm">
          <p>
            The {plural(c.counts.queued, "email")} not sent yet stop and go back to waiting for your approval. Nothing is deleted.
          </p>
          {c.counts.sent ? <p className="text-muted">The {plural(c.counts.sent, "email")} already sent are not affected.</p> : null}
          {confirm === "cancel" && message?.tone === "error" ? <p className="text-danger">{message.text}</p> : null}
        </div>
      </Sheet>

      <Sheet
        open={confirm === "discard"}
        onClose={() => setConfirm(null)}
        title="Discard this mailing?"
        primary={{
          label: "Discard",
          onClick: () => run("discard", () => discardCampaignAction(c.id), undefined, () => router.push("/approvals")),
          pending: running === "discard",
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
              Keep
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => run("discard", () => discardCampaignAction(c.id), undefined, () => router.push("/approvals"))}>
              {running === "discard" ? <Loader2 className="size-4 animate-spin" /> : null}
              Discard {plural(unsent, "email")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[15px] text-fg md:text-sm">
          <p>
            The {plural(unsent, "email")} not sent are removed from Approvals, with their Gmail drafts. Nothing is sent.
          </p>
          {c.counts.sent ? <p className="text-muted">The {plural(c.counts.sent, "email")} already sent are not affected.</p> : null}
          {confirm === "discard" && message?.tone === "error" ? <p className="text-danger">{message.text}</p> : null}
        </div>
      </Sheet>
    </div>
  );
}

/** Where the campaign stands, in words, with progress once it has started. */
function StatusBlock({
  campaign: c,
  held,
  plan,
  size,
  approvable,
  waiting,
  now,
}: {
  campaign: CampaignSummary;
  held: number;
  plan: string;
  size: number;
  /** What "Approve N" would queue. */
  approvable: number;
  /** Not sent and waiting for the owner (approvable + held back). */
  waiting: number;
  now: Date;
}) {
  const tz = c.timezone;
  const attention = held + c.counts.failed;
  const attentionText = attention
    ? `${[held ? `${held} held back` : "", c.counts.failed ? `${c.counts.failed} failed` : ""].filter(Boolean).join(" and ")} — see “Needs you” below.`
    : null;

  if (c.status === "draft") {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/30 md:rounded-lg">
        <p className="text-[13px] font-medium uppercase tracking-wide text-amber-800 md:text-xs dark:text-amber-300">Waiting for your approval</p>
        <p className="mt-1.5 text-[17px] leading-snug text-fg md:text-[15px]">{plan}</p>
        <p className="mt-2 text-[13px] text-muted md:text-xs">Nothing has been sent. Nothing is sent until you approve the mailing.</p>
      </section>
    );
  }

  const next = c.nextSendAt ? whenPhrase(roundUpToTick(new Date(c.nextSendAt)), tz, now) : null;
  const zone = ` (${timeZoneCity(tz)} time)`;

  return (
    <section className="rounded-xl border border-border bg-surface p-4 md:rounded-lg">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[17px] font-semibold tabular-nums text-fg md:text-[15px]">
          {c.counts.sent} of {size} sent
        </p>
        {c.status === "running" ? (
          <span className="flex items-center gap-1.5 text-[13px] text-blue-700 md:text-xs dark:text-blue-300">
            <Send className="size-3.5" strokeWidth={2} aria-hidden /> Sending
          </span>
        ) : c.status === "done" ? (
          <span className="flex items-center gap-1.5 text-[13px] text-emerald-700 md:text-xs dark:text-emerald-400">
            <CircleCheck className="size-3.5" strokeWidth={2} aria-hidden /> Done
          </span>
        ) : null}
      </div>
      <ProgressBar sent={c.counts.sent} held={held} failed={c.counts.failed} total={size} className="mt-2" />

      <div className="mt-3 flex flex-col gap-1.5 text-[15px] text-fg md:text-sm">
        {c.status === "running" ? (
          <>
            <p>
              {next ? (
                <>
                  Next email {next}
                  {zone}
                  {c.finishEstimate && c.remaining > 1 ? `, last one ${whenPhrase(roundUpToTick(new Date(c.finishEstimate)), tz, now)}` : ""}.
                </>
              ) : (
                "Sending the last emails."
              )}
            </p>
            <p className="text-[13px] text-muted md:text-xs">
              {c.counts.queued} queued · {c.sentToday} of {c.dailyCap} sent today · {c.accountSentLast24h} of {ACCOUNT_DAILY_SEND_CAP} from {c.accountEmail} in
              the last 24 hours
            </p>
          </>
        ) : null}

        {c.status === "paused" ? (
          <>
            {c.error ? (
              <Notice tone="warning">
                {c.error}
                {c.accountStatus !== "active" ? (
                  <>
                    {" "}
                    <Link href="/settings" className="font-medium underline underline-offset-2">
                      Open Settings
                    </Link>
                  </>
                ) : null}
              </Notice>
            ) : null}
            <p>Paused — nothing is being sent. {plural(c.counts.queued, "email")} wait their turn.</p>
          </>
        ) : null}

        {c.status === "done" ? (
          <p>
            {waiting
              ? `Every approved email went out or was set aside. ${plural(waiting, "email")} still ${waiting === 1 ? "waits" : "wait"} for you.`
              : "Every approved email was sent."}
          </p>
        ) : null}

        {c.status === "cancelled" ? (
          <>
            <p>Cancelled. {waiting ? `${plural(waiting, "email")} ${waiting === 1 ? "is" : "are"} waiting for your approval.` : "Nothing is left to send."}</p>
            {approvable ? <p className="text-[13px] text-muted md:text-xs">{plan}</p> : null}
          </>
        ) : null}

        {attentionText ? <p className="text-[13px] text-warning md:text-xs">{attentionText}</p> : null}
      </div>
    </section>
  );
}

function ApproveSheet({
  open,
  onClose,
  onConfirm,
  pending,
  count,
  held,
  plan,
  accountEmail,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  count: number;
  held: number;
  plan: string;
  accountEmail: string;
  error: string | null;
}) {
  const label = `Approve ${plural(count, "email")} and start sending`;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Start sending?"
      primary={{ label: "Approve", onClick: onConfirm, pending }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" className="border-red-600 bg-red-600 text-white hover:bg-red-700 dark:border-red-700 dark:bg-red-700" onClick={onConfirm} disabled={pending}>
            {pending ? <VelaLoader size={16} label="Starting" /> : <ShieldCheck className="size-4" strokeWidth={2} />}
            {label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[15px] text-fg md:text-sm">
        <p className="font-medium leading-snug">{plan}</p>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-muted marker:text-subtle">
          <li>They go out one at a time from {accountEmail}, minutes apart — never all at once.</li>
          <li>
            Right before each one, the app checks that the person hasn’t written to you (or you called them) since it was prepared. If they have, the email is held
            back for you to check.
          </li>
          <li>You can pause or cancel at any moment. Emails not sent yet go back to waiting for your approval.</li>
          {held ? (
            <li>
              {plural(held, "email was", "emails were")} held back because the person got in touch: {held === 1 ? "it is" : "they are"} not part of this
              approval. Check the conversation, then use “Queue again” or “Send now” on {held === 1 ? "it" : "each one"}.
            </li>
          ) : null}
        </ul>
        {error ? <p className="text-danger">{error}</p> : null}
        {/* Phones: a full-width button as well as the header's “Approve”. */}
        <Button variant="primary" className={cn("w-full md:hidden")} onClick={onConfirm} disabled={pending}>
          {pending ? <VelaLoader size={16} label="Starting" /> : <ShieldCheck className="size-4" strokeWidth={2} />}
          {label}
        </Button>
      </div>
    </Sheet>
  );
}
