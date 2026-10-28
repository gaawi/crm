import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDownLeft, ChevronDown, CornerDownRight } from "lucide-react";
import { formatRelative } from "@/lib/dates";
import type { EmailDraft } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { DraftThread, ThreadMessage } from "./card-info";

/** Longer than this, the latest email starts folded ("Show all"). */
const LONG = 700;

/**
 * Front of an approval card: the conversation first (earlier emails folded to
 * one line, the latest open), then the email to approve, set apart as "Your
 * reply" so it is clear what is theirs and what would go out.
 */
export function DraftConversation({
  draft,
  thread,
  timezone,
  onEdit,
  onEditEnd,
}: {
  draft: EmailDraft;
  thread: DraftThread | { error: string } | undefined;
  timezone: string;
  /** With it, the subject and the message are edited right on the card (as typed). */
  onEdit?: (fields: { subject: string; body: string }) => void;
  /** Leaving a field: the time to save. */
  onEditEnd?: () => void;
}) {
  const name = draft.contact?.displayName ?? draft.to[0] ?? "this person";
  const loaded = thread && !("error" in thread) ? thread : null;
  const messages = loaded?.messages ?? [];
  const isReply = loaded?.kind === "thread" || Boolean(draft.replyToMessageId);
  const createdAt = new Date(draft.createdAt).getTime();

  return (
    <>
      <section aria-label="Conversation" className="flex flex-col gap-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">
          {!thread
            ? "Loading the conversation…"
            : "error" in thread
              ? thread.error
              : loaded?.kind === "thread"
                ? `Conversation · ${loaded.total} ${loaded.total === 1 ? "email" : "emails"}`
                : loaded?.kind === "history"
                  ? `Latest emails with ${name}`
                  : loaded?.kind === "organization"
                    ? `First email to ${name} · earlier emails with ${loaded.organizationName ?? "their organization"}`
                    : `First email to ${name}`}
        </p>
        {loaded && loaded.total > messages.length ? (
          <p className="text-[11.5px] text-subtle">
            {loaded.total - messages.length} older {loaded.total - messages.length === 1 ? "email" : "emails"} not shown
          </p>
        ) : null}
        {messages.map((m, i) => (
          <Message
            key={m.id}
            message={m}
            latest={i === messages.length - 1}
            fresh={m.direction === "inbound" && new Date(m.sentAt).getTime() > createdAt}
            showSubject={loaded?.kind === "history" || loaded?.kind === "organization" || i === 0}
            timezone={timezone}
          />
        ))}
      </section>

      <section aria-label="Email to approve" className="mt-1 flex flex-col gap-1.5">
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand">
          <CornerDownRight className="size-3.5" aria-hidden />
          {isReply ? "Your reply" : "New email"} · not sent yet
        </p>
        <div className="rounded-xl border border-brand/40 bg-brand/[0.04] px-3 py-2.5">
          <p className="text-[11.5px] leading-snug text-subtle">
            To {draft.to.join(", ")}
            {draft.cc.length ? ` · Cc ${draft.cc.join(", ")}` : ""}
          </p>
          {onEdit ? (
            <EditableEmail key={draft.id} draft={draft} onEdit={onEdit} onEditEnd={onEditEnd} />
          ) : (
            <>
              <h2 className="mt-0.5 text-[15px] font-semibold leading-snug">{draft.subject || "(no subject)"}</h2>
              <div className="mt-1 whitespace-pre-wrap text-[13px] leading-[1.45] text-fg md:text-[13.5px]">{draft.body}</div>
            </>
          )}
        </div>
      </section>
    </>
  );
}

/**
 * The email as a draft: subject and message look like the email but are typed
 * into in place (the message grows with its text, no box to scroll inside).
 */
export function EditableEmail({
  draft,
  onEdit,
  onEditEnd,
}: {
  draft: EmailDraft;
  onEdit: (fields: { subject: string; body: string }) => void;
  onEditEnd?: () => void;
}) {
  const subject = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const grow = () => {
    const el = body.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(grow, []);
  const changed = () => {
    grow();
    onEdit({ subject: subject.current?.value ?? draft.subject, body: body.current?.value ?? draft.body });
  };
  const field = "w-full resize-none border-0 bg-transparent p-0 text-fg outline-none focus:ring-0 rounded-sm focus-visible:bg-surface/70";
  return (
    <>
      <input
        ref={subject}
        defaultValue={draft.subject}
        placeholder="(no subject)"
        aria-label="Subject"
        onChange={changed}
        onBlur={onEditEnd}
        className={cn(field, "mt-0.5 text-[15px] font-semibold leading-snug")}
      />
      <textarea
        ref={body}
        defaultValue={draft.body}
        aria-label="Message"
        rows={3}
        onChange={changed}
        onBlur={onEditEnd}
        className={cn(field, "mt-1 overflow-hidden text-[13px] leading-[1.45] md:text-[13.5px]")}
      />
    </>
  );
}

/** One earlier email: folded to a line (tap to open), the latest open and folded only when long. */
function Message({
  message: m,
  latest,
  fresh,
  showSubject,
  timezone,
}: {
  message: ThreadMessage;
  latest: boolean;
  fresh: boolean;
  showSubject: boolean;
  timezone: string;
}) {
  const long = m.body.length > LONG || m.body.split("\n").length > 14;
  const [open, setOpen] = useState(latest);
  const [all, setAll] = useState(!long);
  const mine = m.direction === "outbound";
  const when = formatRelative(new Date(m.sentAt), timezone);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-baseline gap-2 rounded-lg bg-surface-2/70 px-2.5 py-1.5 text-left text-[12px] leading-snug active:opacity-70"
      >
        <span className={cn("shrink-0 font-semibold", mine ? "text-brand" : "text-success")}>{m.from}</span>
        {mine && m.recipients > 3 ? <span className="shrink-0 text-[11px] text-subtle">mass email</span> : null}
        <span className="min-w-0 flex-1 truncate text-muted">{m.body.replace(/\s+/g, " ")}</span>
        <span className="shrink-0 text-[11px] text-subtle">{when}</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg px-2.5 py-2",
        mine ? "border border-border bg-surface" : "border-l-[3px] border-success bg-success/[0.07]",
        fresh && "ring-1 ring-warning/60",
      )}
    >
      <button type="button" onClick={() => !latest && setOpen(false)} className="flex w-full items-baseline gap-2 text-left text-[12px] leading-snug">
        {mine ? null : <ArrowDownLeft className="size-3.5 shrink-0 self-center text-success" aria-label="From them" />}
        <span className={cn("min-w-0 truncate font-semibold", mine ? "text-brand" : "text-success")}>{m.from}</span>
        {mine && m.recipients > 3 ? (
          <span className="min-w-0 truncate text-subtle">mass email to {m.recipients} people</span>
        ) : mine && m.to ? (
          <span className="min-w-0 truncate text-subtle">to {m.to}</span>
        ) : null}
        {m.about === "organization" ? (
          <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10.5px] text-subtle">same organization</span>
        ) : null}
        <span className="ml-auto shrink-0 text-[11px] text-subtle">{when}</span>
      </button>
      {fresh ? <p className="mt-0.5 text-[11px] font-medium text-warning">New since this draft was written</p> : null}
      {showSubject && m.subject ? <p className="mt-0.5 text-[12px] font-medium text-fg/80">{m.subject}</p> : null}
      <div className={cn("mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.4] text-fg/90", !all && "line-clamp-[12]")}>
        {m.body || <span className="text-subtle">(no text)</span>}
      </div>
      {long ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 inline-flex items-center gap-0.5 text-[12px] font-medium text-brand">
          {all ? "Show less" : "Show all"}
          <ChevronDown className={cn("size-3.5 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
