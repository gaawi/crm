"use client";

import Link from "next/link";
import { ContactOrgAvatar } from "@/components/contact-org-avatar";
import { useClaudeEnabled } from "@/components/features";
import { useEffect, useState, useTransition } from "react";
import { CalendarClock, Check, FileText, Hourglass, MessageSquareText, Pencil, Send, Sparkles, Trash2 } from "lucide-react";
import { PostponeForm } from "@/components/assistant/review";
import { VelaLoader } from "@/components/brand/vela-logo";
import { celebrateSend, flourishOrigin, type FlourishOrigin } from "@/components/brand/send-flourish";
import { OrgProfileLine } from "@/components/organizations/profile-card";
import { AccountBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/layout";
import { approveDraftAction, discardDraftAction, reviseDraftAction, saveDraftEditsAction, type ActionResult } from "@/lib/ai/actions";
import { postponeAssistantDraftAction, requestAssistantChangesAction } from "@/lib/assistant/actions";
import { ASSISTANT_REVIEW_TIMES } from "@/lib/assistant/types";
import { isTemplateRationale } from "@/lib/booking/templates";
import { formatDate, formatRelative, todayIn } from "@/lib/dates";
import type { EmailDraft } from "@/lib/types";
import { cn } from "@/lib/utils";

const PURPOSE_LABEL: Record<EmailDraft["purpose"], string> = {
  reply: "Reply",
  follow_up: "Follow-up",
  nudge: "Nudge",
  outreach: "Outreach",
  other: "Email",
};

const ORIGIN_LABEL: Record<EmailDraft["origin"], string> = {
  assistant: "Claude",
  autopilot: "Autopilot",
  owner: "You + Claude",
};

/**
 * One email waiting for approval. Approve & send needs two taps (the first arms
 * the button for 4 s) so a stray tap on the phone never sends an email.
 */
export function DraftCard({
  draft,
  timezone,
  compact = false,
}: {
  draft: EmailDraft;
  timezone: string;
  /** List view: body clamped, links to the full review screen. */
  compact?: boolean;
}) {
  const claude = useClaudeEnabled();
  const [mode, setMode] = useState<"view" | "edit" | "revise" | "changes" | "postpone">("view");
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = pending || draft.status === "sending" || draft.status === "revising";
  const closed = draft.status === "sent" || draft.status === "discarded";
  /**
   * "Request changes" and "Postpone" go through the daily campaign assistant:
   * its review (lib/assistant/context.ts → POST /api/assistant-agent/proposals
   * "revisions") only rewrites emails tied to a campaign — a campaign row's
   * email or one of its actions (assistantProjectId). Other drafts (Claude's
   * replies, the autopilot's, even origin "assistant" ones without a
   * campaign) would wait forever, so they keep "Change" (Claude rewrites
   * right away) instead. Emails of an Approvals campaign (campaignId) follow
   * that campaign's approval and pace, so they are left out too.
   */
  const assistantFlow = Boolean(draft.assistantProjectId) && !draft.campaignId;
  const waitingVersion = draft.status === "changes_requested";
  const postponed = draft.status === "postponed";

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const run = (action: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok) after?.();
    });

  const onApprove = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    const origin: FlourishOrigin | null = flourishOrigin(event.currentTarget);
    run(
      () => approveDraftAction(draft.id),
      () => celebrateSend(origin),
    );
  };

  return (
    <article id={`draft-${draft.id}`} className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
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
        ) : null}
        <span className="min-w-0 truncate text-[15px] font-medium md:text-sm">
          {draft.contact ? (
            <Link href={`/contacts/${draft.contact.id}`} className="hover:underline">
              {draft.contact.displayName}
            </Link>
          ) : (
            draft.to.join(", ")
          )}
        </span>
        <Badge>{PURPOSE_LABEL[draft.purpose]}</Badge>
        {draft.status === "queued" ? (
          <Badge
            className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            title="Approved: it goes out with its mailing, a few at a time"
          >
            Queued
          </Badge>
        ) : null}
        {/* Prepared from a campaign template: your words, not Claude's. */}
        {draft.assistantReason ? (
          <Badge className="font-normal" title="Prepared by the daily campaign assistant">
            <Sparkles className="size-3" /> Campaign assistant
          </Badge>
        ) : draft.origin === "owner" && isTemplateRationale(draft.rationale) ? (
          <Badge className="font-normal">
            <FileText className="size-3" /> Your template
          </Badge>
        ) : (
          <Badge className="font-normal">
            <Sparkles className="size-3" /> {ORIGIN_LABEL[draft.origin]}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-subtle">
          <AccountBadge email={draft.accountEmail} />
          {formatRelative(draft.updatedAt, timezone)}
        </span>
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
        ) : draft.rationale ? (
          <p className="text-sm italic text-muted">{draft.rationale}</p>
        ) : null}
        {draft.error && !closed ? <Notice tone="warning">{draft.error}</Notice> : null}

        {mode === "edit" ? (
          <form
            className="flex flex-col gap-2"
            action={(formData) =>
              run(
                () => saveDraftEditsAction(draft.id, formData),
                () => setMode("view"),
              )
            }
          >
            <Input name="to" defaultValue={draft.to.join(", ")} aria-label="To" placeholder="To" />
            <Input name="cc" defaultValue={draft.cc.join(", ")} aria-label="Cc" placeholder="Cc" />
            <Input name="subject" defaultValue={draft.subject} aria-label="Subject" placeholder="Subject" />
            <Textarea name="body" defaultValue={draft.body} rows={12} aria-label="Message" />
            <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
              <Button type="button" variant="ghost" onClick={() => setMode("view")} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-1.5">
            <dl className="grid grid-cols-[2.5rem_1fr] gap-x-2 text-xs">
              <dt className="text-subtle">To</dt>
              <dd className="min-w-0 truncate text-muted">{draft.to.join(", ")}</dd>
              {draft.cc.length ? (
                <>
                  <dt className="text-subtle">Cc</dt>
                  <dd className="min-w-0 truncate text-muted">{draft.cc.join(", ")}</dd>
                </>
              ) : null}
            </dl>
            <p className="text-[15px] font-medium md:text-sm">{draft.subject || "(no subject)"}</p>
            {draft.replyToSubject ? <p className="text-xs text-subtle">In reply to “{draft.replyToSubject}”</p> : null}
            <div className={cn("prose-plain text-[15px] leading-relaxed text-fg md:text-sm", compact && "line-clamp-6")}>{draft.body}</div>
            {compact ? (
              <Link href={`/approvals/${draft.id}`} className="text-sm text-muted hover:text-fg">
                Open full email →
              </Link>
            ) : null}
          </div>
        )}

        {mode === "revise" ? (
          <form
            className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
            action={() =>
              run(
                () => reviseDraftAction(draft.id, note),
                () => {
                  setNote("");
                  setMode("view");
                },
              )
            }
          >
            <label htmlFor={`note-${draft.id}`} className="text-xs font-medium text-muted">
              Tell Claude what to change
            </label>
            <Textarea
              id={`note-${draft.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Shorter, mention the Oct 12 date, write it in Spanish…"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
              <Button type="button" variant="ghost" onClick={() => setMode("view")} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending || !note.trim()}>
                {pending ? (
                  <>
                    <VelaLoader size={16} label="Rewriting" /> Rewriting…
                  </>
                ) : (
                  "Rewrite"
                )}
              </Button>
            </div>
          </form>
        ) : null}

        {mode === "changes" ? (
          <form
            className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => requestAssistantChangesAction(draft.id, comment),
                () => {
                  setComment("");
                  setMode("view");
                },
              );
            }}
          >
            <label htmlFor={`changes-${draft.id}`} className="text-xs font-medium text-muted">
              What should change?
            </label>
            <Textarea
              id={`changes-${draft.id}`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Shorter, mention the October dates, write it in Spanish…"
              autoFocus
              required
            />
            <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
              <Button type="button" variant="ghost" onClick={() => setMode("view")} disabled={pending}>
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
            today={todayIn(timezone)}
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

        {result && !result.ok ? <p className="text-sm text-danger">{result.error}</p> : null}
        {result?.ok && result.message ? <p className="text-sm text-success">{result.message}</p> : null}
      </div>

      {closed ? (
        <footer className="border-t border-border px-4 py-3 text-sm text-muted">
          {draft.status === "sent" ? `Sent ${formatRelative(draft.sentAt, timezone)}` : "Discarded"}
        </footer>
      ) : waitingVersion ? (
        <footer className="flex items-start gap-2.5 border-t border-border px-4 py-3 text-sm" data-testid="waiting-version">
          <Hourglass className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">Waiting for new version</p>
            <p className="text-[13px] text-muted md:text-xs">Claude rewrites it in the next review ({ASSISTANT_REVIEW_TIMES}).</p>
            {draft.revisionRequest ? <p className="mt-1 text-[13px] text-muted md:text-xs">You asked: “{draft.revisionRequest}”</p> : null}
          </div>
        </footer>
      ) : postponed && mode === "view" ? (
        <footer className="flex items-center gap-2.5 border-t border-border px-4 py-3 text-sm text-muted">
          <CalendarClock className="size-4 shrink-0 text-subtle" aria-hidden />
          <span className="min-w-0 flex-1">
            Postponed{draft.postponedUntil ? ` until ${formatDate(draft.postponedUntil, timezone)}` : ""}: it comes back by itself that day.
          </span>
        </footer>
      ) : mode === "view" ? (
        <footer className="grid grid-cols-2 gap-2 border-t border-border px-4 py-3 md:flex md:flex-wrap md:items-center">
          <Button
            variant="primary"
            className={cn("col-span-2 md:order-first md:min-w-[11rem]", armed && "bg-success text-white")}
            onClick={onApprove}
            disabled={busy}
          >
            {draft.status === "sending" || (pending && armed) ? (
              <>
                <VelaLoader size={16} label="Sending" className="text-current" /> Sending…
              </>
            ) : armed ? (
              "Tap again to send"
            ) : draft.campaignId ? (
              // A campaign email: this sends just this one now, outside the campaign's pace.
              <>
                <Send className="size-4" /> Send now
              </>
            ) : (
              <>
                <Check className="size-4" /> Approve & send
              </>
            )}
          </Button>
          {assistantFlow ? (
            <Button onClick={() => setMode("changes")} disabled={busy}>
              <MessageSquareText className="size-4 shrink-0" /> Request changes
            </Button>
          ) : claude ? (
            <Button onClick={() => setMode("revise")} disabled={busy}>
              <Sparkles className="size-4" /> Change
            </Button>
          ) : null}
          <Button onClick={() => setMode("edit")} disabled={busy}>
            <Pencil className="size-4" /> Edit
          </Button>
          {assistantFlow ? (
            <Button onClick={() => setMode("postpone")} disabled={busy}>
              <CalendarClock className="size-4" /> Postpone
            </Button>
          ) : null}
          <Button
            variant="danger"
            className={!assistantFlow && claude ? "col-span-2 md:col-span-1" : undefined}
            onClick={() => run(() => discardDraftAction(draft.id))}
            disabled={busy}
          >
            <Trash2 className="size-4" /> Discard
          </Button>
        </footer>
      ) : null}
    </article>
  );
}
