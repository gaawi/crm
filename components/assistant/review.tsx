"use client";

import Link from "next/link";
import { TheyWroteBadge } from "@/components/approvals/they-wrote";
import { CampaignPill } from "@/components/campaign-pill";
import { useEffect, useState, useTransition } from "react";
import { CalendarClock, Check, ChevronDown, ListTodo, Mail, MessageCircle, MessageSquareText, Pencil, Phone, Send, Trash2, X } from "lucide-react";
import { CallButton, WhatsAppButton } from "@/components/booking/phone-actions";
import { VelaLoader } from "@/components/brand/vela-logo";
import { celebrateSend, flourishOrigin } from "@/components/brand/send-flourish";
import { ContactAvatar } from "@/components/contact-avatar";
import { ContactOrgAvatar } from "@/components/contact-org-avatar";
import { OrgProfileLine } from "@/components/organizations/profile-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/layout";
import {
  approveAssistantDraftAction,
  discardAssistantDraftAction,
  editAssistantDraftAction,
  postponeAssistantDraftAction,
  commentAssistantActionAction,
  requestAssistantChangesAction,
  setAssistantActionStatusAction,
} from "@/lib/assistant/actions";
import { ASSISTANT_REVIEW_TIMES, DEFAULT_POSTPONE_DAYS, MAX_ACTION_COMMENT, type AssistantAction } from "@/lib/assistant/types";
import { addDays } from "@/lib/dates";
import type { EmailDraft } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The owner's review of the daily campaign assistant: its emails (approve,
 * edit, request changes, postpone, discard) and its recommended actions
 * (call, WhatsApp, comment, done, postpone, dismiss). Approve & send needs two taps.
 */

type Outcome = { ok: true; message?: string } | { ok: false; error: string };

const PRIORITY: Record<number, { label: string; className: string }> = {
  1: { label: "High", className: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
  2: { label: "Normal", className: "" },
  3: { label: "Low", className: "text-subtle" },
};

export function PriorityBadge({ priority }: { priority: number }) {
  if (priority !== 1) return null;
  const p = PRIORITY[priority];
  return <Badge className={p.className}>{p.label}</Badge>;
}

function useRun() {
  const [result, setResult] = useState<Outcome | null>(null);
  const [pending, start] = useTransition();
  const run = (action: () => Promise<Outcome>, after?: () => void) =>
    start(async () => {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok) after?.();
    });
  return { result, pending, run };
}

/** Postpone with a date (default a week from today). */
export function PostponeForm({
  today,
  onSubmit,
  onCancel,
  pending,
}: {
  today: string;
  onSubmit: (date: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [date, setDate] = useState(addDays(today, DEFAULT_POSTPONE_DAYS));
  return (
    <form
      className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 md:flex-row md:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(date);
      }}
    >
      <label className="flex flex-1 items-center gap-2 text-sm text-muted">
        Show again on
        <Input
          type="date"
          value={date}
          min={addDays(today, 1)}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 md:max-w-[11rem]"
          aria-label="Postpone until"
          required
        />
      </label>
      <div className="grid grid-cols-2 gap-2 md:flex">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          Postpone
        </Button>
      </div>
    </form>
  );
}

export function AssistantDraftCard({
  draft,
  projectName,
  priority,
  today,
  showProject = true,
}: {
  draft: EmailDraft;
  projectName: string;
  priority: number;
  /** 'YYYY-MM-DD' in the owner's timezone. */
  today: string;
  showProject?: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "changes" | "postpone">("view");
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [comment, setComment] = useState("");
  const { result, pending, run } = useRun();
  const busy = pending || draft.status === "sending" || draft.status === "revising";

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const onApprove = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    const origin = flourishOrigin(event.currentTarget);
    run(
      () => approveAssistantDraftAction(draft.id),
      () => celebrateSend(origin),
    );
  };

  const to = draft.contact?.displayName ?? draft.to.join(", ");

  return (
    <article data-testid="assistant-draft" className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
      <header className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3">
        {draft.contact ? (
          <ContactOrgAvatar
            contact={draft.contact}
            organization={
              draft.organization ? { id: draft.organization.id, name: draft.organization.name, logo: draft.organization.profile.logo } : null
            }
            layout="badge"
            size="sm"
            className="mr-1"
          />
        ) : (
          <Mail className="size-4 shrink-0 text-subtle" aria-hidden />
        )}
        <span className="min-w-0 truncate text-[15px] font-medium md:text-sm">
          {draft.contact ? (
            <Link href={`/contacts/${draft.contact.id}`} className="hover:underline">
              {to}
            </Link>
          ) : (
            to
          )}
        </span>
        {draft.campaign ? <CampaignPill campaign={draft.campaign} link /> : null}
        {draft.theyWrote ? <TheyWroteBadge at={draft.theyWrote.at} /> : null}
        <PriorityBadge priority={priority} />
        {showProject ? <span className="ml-auto truncate text-xs text-subtle">{projectName}</span> : null}
      </header>

      <div className="flex min-w-0 flex-col gap-3 px-4 py-3 [overflow-wrap:anywhere]">
        {draft.organization ? (
          <OrgProfileLine
            profile={draft.organization.profile}
            organization={draft.organization}
            editHref={`/organizations/${draft.organization.id}?profile=edit`}
          />
        ) : null}
        {draft.assistantReason ? (
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">Why: </span>
            {draft.assistantReason}
          </p>
        ) : null}
        {draft.error ? <Notice tone="warning">{draft.error}</Notice> : null}

        {mode === "edit" ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              run(
                () => editAssistantDraftAction(draft.id, String(data.get("subject") ?? ""), String(data.get("body") ?? "")),
                () => setMode("view"),
              );
            }}
          >
            <Input name="subject" defaultValue={draft.subject} aria-label="Subject" placeholder="Subject" />
            <Textarea name="body" defaultValue={draft.body} rows={10} aria-label="Message" />
            <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
              <Button variant="ghost" onClick={() => setMode("view")} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="truncate text-xs text-muted">To {draft.to.join(", ")}</p>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex min-h-11 items-center gap-2 text-left text-[15px] font-medium md:min-h-0 md:text-sm"
            >
              <span className="min-w-0 flex-1">{draft.subject || "(no subject)"}</span>
              <ChevronDown className={cn("size-4 shrink-0 text-subtle transition-transform", open && "rotate-180")} aria-hidden />
            </button>
            <div className={cn("prose-plain text-[15px] leading-relaxed text-fg md:text-sm", !open && "line-clamp-3 text-muted")}>{draft.body}</div>
          </div>
        )}

        {mode === "changes" ? (
          <form
            className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => requestAssistantChangesAction(draft.id, comment),
                () => setMode("view"),
              );
            }}
          >
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="What should change? (e.g. shorter, mention the October dates)"
              autoFocus
              aria-label="Requested changes"
              required
            />
            <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
              <Button variant="ghost" onClick={() => setMode("view")} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending || !comment.trim()}>
                Send to assistant
              </Button>
            </div>
          </form>
        ) : null}

        {mode === "postpone" ? (
          <PostponeForm
            today={today}
            pending={pending}
            onCancel={() => setMode("view")}
            onSubmit={(date) =>
              run(
                () => postponeAssistantDraftAction(draft.id, date),
                () => setMode("view"),
              )
            }
          />
        ) : null}

        {result ? <Notice tone={result.ok ? "success" : "error"}>{result.ok ? (result.message ?? "Done") : result.error}</Notice> : null}

        {mode === "view" ? (
          <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
            <Button
              variant="primary"
              onClick={onApprove}
              disabled={busy}
              className={cn("col-span-2 md:min-w-[11rem]", armed && "bg-success text-white")}
            >
              {draft.status === "sending" || (pending && armed) ? <VelaLoader size={16} label="Sending" /> : <Send className="size-4" />}{" "}
              {draft.status === "sending" || (pending && armed) ? "Sending…" : armed ? "Tap again to send" : "Approve & send"}
            </Button>
            <Button onClick={() => setMode("changes")} disabled={busy}>
              <MessageSquareText className="size-4 shrink-0" /> Request changes
            </Button>
            <Button onClick={() => setMode("edit")} disabled={busy}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button onClick={() => setMode("postpone")} disabled={busy}>
              <CalendarClock className="size-4" /> Postpone
            </Button>
            <Button variant="danger" onClick={() => run(() => discardAssistantDraftAction(draft.id))} disabled={busy}>
              <Trash2 className="size-4" /> Discard
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

const KIND_ICON = { email: Mail, call: Phone, whatsapp: MessageCircle, task: ListTodo } as const;

/** A recommended action: Call / WhatsApp when there is a number, then Done · Postpone · Dismiss. */
/** The conversation on an action: the owner's comments and the assistant's answers. */
function ActionComments({ action }: { action: AssistantAction }) {
  if (!action.comments.length) return null;
  const waiting = action.comments[action.comments.length - 1].by === "owner";
  return (
    <div className="flex flex-col gap-1.5 pl-0 md:pl-6" data-testid="action-comments">
      {action.comments.map((c, i) => (
        <div
          key={i}
          className={cn(
            "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap md:text-xs",
            c.by === "owner" ? "self-end bg-accent/10 text-fg" : "self-start border border-border bg-surface-2 text-fg",
          )}
        >
          <span className="mb-0.5 block text-[11px] font-medium text-subtle">{c.by === "owner" ? "You" : "Assistant"}</span>
          {c.text}
        </div>
      ))}
      {waiting ? <p className="self-end text-xs text-subtle">The assistant answers on its next review ({ASSISTANT_REVIEW_TIMES}).</p> : null}
    </div>
  );
}

/** Comment on an action: the assistant reads it, answers and updates or closes the action. */
function CommentForm({ pending, onCancel, onSubmit }: { pending: boolean; onCancel: () => void; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex flex-col gap-2 pl-0 md:pl-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text);
      }}
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={MAX_ACTION_COMMENT}
        placeholder="Your comment for the assistant (e.g. I already called her, better an email, wait until January)"
        autoFocus
        aria-label="Comment"
        required
      />
      <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending || !text.trim()}>
          Send to assistant
        </Button>
      </div>
    </form>
  );
}

export function AssistantActionRow({ action, today, showProject = true }: { action: AssistantAction; today: string; showProject?: boolean }) {
  const [mode, setMode] = useState<"view" | "postpone" | "comment">("view");
  const { result, pending, run } = useRun();
  const Icon = KIND_ICON[action.kind];
  const closed = action.status === "done" || action.status === "dismissed";

  return (
    <li data-testid="assistant-action" className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-2.5">
        {action.contact ? (
          <span className="relative shrink-0" title={action.contact.displayName}>
            <ContactAvatar contact={action.contact} size="sm" />
            <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border border-border bg-surface">
              <Icon className="size-2.5 text-muted" aria-hidden />
            </span>
          </span>
        ) : (
          <Icon className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("text-[15px] font-medium md:text-sm", closed && "text-muted line-through decoration-subtle/60")}>{action.title}</p>
          {action.reason ? <p className="text-sm text-muted md:text-xs">{action.reason}</p> : null}
          <p className="mt-0.5 truncate text-xs text-subtle">
            {[
              showProject ? action.projectName : null,
              action.rowName,
              action.contact && action.contact.displayName !== action.rowName ? action.contact.displayName : null,
              action.status === "postponed" && action.postponedUntil ? `Until ${action.postponedUntil}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <PriorityBadge priority={action.priority} />
      </div>
      <ActionComments action={action} />
      {mode === "postpone" ? (
        <PostponeForm
          today={today}
          pending={pending}
          onCancel={() => setMode("view")}
          onSubmit={(date) =>
            run(
              () => setAssistantActionStatusAction(action.id, "postponed", date),
              () => setMode("view"),
            )
          }
        />
      ) : mode === "comment" ? (
        <CommentForm
          pending={pending}
          onCancel={() => setMode("view")}
          onSubmit={(text) =>
            run(
              () => commentAssistantActionAction(action.id, text),
              () => setMode("view"),
            )
          }
        />
      ) : closed || action.status === "postponed" ? (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => run(() => setAssistantActionStatusAction(action.id, "open"))} disabled={pending}>
            Reopen
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("comment")} disabled={pending}>
            <MessageSquareText className="size-4" /> Comment
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pl-0 md:pl-6">
          {action.contact && (action.kind === "call" || action.kind === "whatsapp" || action.kind === "task") ? (
            <>
              <CallButton phone={action.contact.phone} size="button" />
              <WhatsAppButton contact={action.contact} size="button" />
            </>
          ) : null}
          {action.kind === "email" && action.draftId ? (
            <Link href={`/approvals/${action.draftId}`} className="text-sm text-muted underline-offset-2 hover:underline">
              Open email
            </Link>
          ) : null}
          <span className="ml-auto flex gap-1">
            <Button size="md" onClick={() => run(() => setAssistantActionStatusAction(action.id, "done"))} disabled={pending} aria-label="Done">
              <Check className="size-4" /> Done
            </Button>
            <Button size="md" variant="ghost" onClick={() => setMode("comment")} disabled={pending} aria-label="Comment">
              <MessageSquareText className="size-4" />
              <span className="sr-only md:not-sr-only">Comment</span>
            </Button>
            <Button size="md" variant="ghost" onClick={() => setMode("postpone")} disabled={pending} aria-label="Postpone">
              <CalendarClock className="size-4" />
              <span className="sr-only md:not-sr-only">Postpone</span>
            </Button>
            <Button
              size="md"
              variant="ghost"
              onClick={() => run(() => setAssistantActionStatusAction(action.id, "dismissed"))}
              disabled={pending}
              aria-label="Dismiss"
            >
              <X className="size-4" />
              <span className="sr-only md:not-sr-only">Dismiss</span>
            </Button>
          </span>
        </div>
      )}
      {result && !result.ok ? <Notice tone="error">{result.error}</Notice> : null}
    </li>
  );
}
