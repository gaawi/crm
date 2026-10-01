"use client";

import Link from "next/link";
import { useClaudeEnabled } from "@/components/features";
import { useEffect, useState, useTransition } from "react";
import { Check, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react";
import { AccountBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/layout";
import { approveDraftAction, discardDraftAction, reviseDraftAction, saveDraftEditsAction, type ActionResult } from "@/lib/ai/actions";
import { formatRelative } from "@/lib/dates";
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
  const [mode, setMode] = useState<"view" | "edit" | "revise">("view");
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = pending || draft.status === "sending" || draft.status === "revising";
  const closed = draft.status === "sent" || draft.status === "discarded";

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

  const onApprove = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    run(() => approveDraftAction(draft.id));
  };

  return (
    <article id={`draft-${draft.id}`} className="overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
      <header className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3">
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
        <Badge className="font-normal">
          <Sparkles className="size-3" /> {ORIGIN_LABEL[draft.origin]}
        </Badge>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-subtle">
          <AccountBadge email={draft.accountEmail} />
          {formatRelative(draft.updatedAt, timezone)}
        </span>
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">
        {draft.rationale ? <p className="text-sm italic text-muted">{draft.rationale}</p> : null}
        {draft.error && !closed ? <Notice tone="warning">{draft.error}</Notice> : null}

        {mode === "edit" ? (
          <form
            className="flex flex-col gap-2"
            action={(formData) => run(() => saveDraftEditsAction(draft.id, formData), () => setMode("view"))}
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
            action={() => run(() => reviseDraftAction(draft.id, note), () => {
              setNote("");
              setMode("view");
            })}
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
                    <Loader2 className="size-4 animate-spin" /> Rewriting…
                  </>
                ) : (
                  "Rewrite"
                )}
              </Button>
            </div>
          </form>
        ) : null}

        {result && !result.ok ? <p className="text-sm text-danger">{result.error}</p> : null}
        {result?.ok && result.message ? <p className="text-sm text-success">{result.message}</p> : null}
      </div>

      {closed ? (
        <footer className="border-t border-border px-4 py-3 text-sm text-muted">
          {draft.status === "sent" ? `Sent ${formatRelative(draft.sentAt, timezone)}` : "Discarded"}
        </footer>
      ) : mode === "view" ? (
        <footer className="grid grid-cols-3 gap-2 border-t border-border px-4 py-3 md:flex md:items-center">
          <Button
            variant="primary"
            className={cn("col-span-3 md:order-last md:ml-auto", armed && "bg-success text-white")}
            onClick={onApprove}
            disabled={busy}
          >
            {draft.status === "sending" || (pending && armed) ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Sending…
              </>
            ) : armed ? (
              "Tap again to send"
            ) : (
              <>
                <Check className="size-4" /> Approve & send
              </>
            )}
          </Button>
          {claude ? (
            <Button onClick={() => setMode("revise")} disabled={busy}>
              <Sparkles className="size-4" /> Change
            </Button>
          ) : null}
          <Button onClick={() => setMode("edit")} disabled={busy}>
            <Pencil className="size-4" /> Edit
          </Button>
          <Button variant="danger" onClick={() => run(() => discardDraftAction(draft.id))} disabled={busy}>
            <Trash2 className="size-4" /> Discard
          </Button>
        </footer>
      ) : null}
    </article>
  );
}
