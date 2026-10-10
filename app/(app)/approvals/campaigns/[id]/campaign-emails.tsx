"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ListRestart, Loader2 } from "lucide-react";
import { ContactAvatar } from "@/components/contact-avatar";
import { DraftCard } from "@/components/draft-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isHeldBack } from "@/lib/campaigns/format";
import { formatRelative } from "@/lib/dates";
import type { EmailDraft } from "@/lib/types";
import { cn } from "@/lib/utils";
import { requeueHeldDraftAction } from "../../actions";

/**
 * The campaign's emails as compact rows (who, subject, status, and why when
 * it needs you). Tapping a row opens the usual draft card inline: edit,
 * discard or send that one now. Rows that need the owner start open; a
 * held-back one also offers "Queue again" once the owner has checked the
 * conversation.
 */

/** A held-back email: put it back in the campaign's queue (the reply check restarts from now). */
function RequeueBar({ draftId }: { draftId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 border-x border-border bg-amber-50/60 px-4 py-3 dark:bg-amber-950/30 md:flex-row md:items-center md:gap-3 md:py-2">
      <p className="min-w-0 flex-1 text-[13px] text-muted md:text-xs">
        Checked the conversation and it should still go out? Queue it again: it is sent with the campaign, unless they get in touch again.
        {error ? <span className="mt-1 block text-danger">{error}</span> : null}
      </p>
      <Button
        size="sm"
        className="h-11 shrink-0 md:h-7"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await requeueHeldDraftAction(draftId).catch(() => ({ ok: false as const, error: "Not saved. Try again." }));
            setError(result.ok ? null : result.error);
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin md:size-3.5" /> : <ListRestart className="size-4 md:size-3.5" strokeWidth={1.75} />}
        Queue again
      </Button>
    </div>
  );
}

function statusBadge(draft: EmailDraft, timezone: string) {
  if (isHeldBack(draft)) return <Badge className="bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Held back</Badge>;
  switch (draft.status) {
    case "queued":
      return <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">Queued</Badge>;
    case "sending":
      return <Badge className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">Sending…</Badge>;
    case "sent":
      return (
        <Badge className="bg-emerald-50 font-normal text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Sent {formatRelative(draft.sentAt, timezone)}</Badge>
      );
    case "failed":
      return <Badge className="bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">Failed</Badge>;
    case "discarded":
      return <Badge className="text-subtle">Discarded</Badge>;
    case "revising":
      return <Badge>Rewriting…</Badge>;
    default:
      return <Badge>To approve</Badge>;
  }
}

export function CampaignEmails({ drafts, timezone, defaultOpen = false }: { drafts: EmailDraft[]; timezone: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen ? drafts.map((d) => d.id) : []));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((d, i) => {
        const expanded = open.has(d.id);
        const reason = d.status === "failed" || isHeldBack(d) ? d.error : null;
        return (
          <li key={d.id} className="min-w-0">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={`campaign-email-${d.id}`}
              onClick={() => toggle(d.id)}
              className={cn(
                "flex min-h-[60px] w-full items-start gap-3 border border-border bg-surface px-4 py-2.5 text-left active:bg-surface-2 md:min-h-0 md:hover:bg-surface-2/60",
                expanded ? "rounded-t-xl border-b-0 md:rounded-t-lg" : "rounded-xl md:rounded-lg",
              )}
            >
              <span className="mt-0.5 w-6 shrink-0 text-right text-xs tabular-nums text-subtle" aria-hidden>
                {i + 1}
              </span>
              <ContactAvatar contact={d.contact ?? { displayName: d.to[0] ?? "?" }} size="sm" className="-my-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-fg md:text-sm">{d.contact?.displayName ?? d.to.join(", ")}</span>
                  <span className="shrink-0">{statusBadge(d, timezone)}</span>
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-muted md:text-xs">
                  {d.to.join(", ")} · {d.subject || "(no subject)"}
                </span>
                {reason ? <span className="mt-1 block text-[13px] text-warning md:text-xs">{reason}</span> : null}
              </span>
              <ChevronDown className={cn("mt-1 size-4 shrink-0 text-subtle transition-transform", expanded && "rotate-180")} aria-hidden />
            </button>
            {expanded ? (
              <div id={`campaign-email-${d.id}`} className="[&>article]:rounded-t-none">
                {isHeldBack(d) ? <RequeueBar draftId={d.id} /> : null}
                <DraftCard draft={d} timezone={timezone} compact />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
