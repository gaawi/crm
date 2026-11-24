"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { rowDraftAction } from "@/app/(app)/campaigns/actions";
import { DraftCard } from "@/components/draft-card";
import { InlineThread } from "@/components/mail/inline-thread";
import type { CampaignReply } from "@/lib/queries/campaign-replies";
import type { EmailDraft } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The reply waiting in Approvals, shown under the conversation. */
function DraftHere({ draftId, timezone }: { draftId: string; timezone: string }) {
  const [draft, setDraft] = useState<EmailDraft | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    rowDraftAction(draftId).then(
      (d) => live && setDraft(d),
      () => live && setDraft(null),
    );
    return () => {
      live = false;
    };
  }, [draftId]);
  if (!draft) return null;
  return (
    <section aria-label="Draft waiting to be sent" className="rounded-xl border-2 border-blue-500/60 p-2 md:rounded-lg">
      <p className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">Draft ready to send</p>
      <DraftCard draft={draft} timezone={timezone} />
    </section>
  );
}

/**
 * One reply in Today's inbox: a Gmail-like line that unfolds in place (the
 * conversation, Reply, and the prepared draft when there is one), so the
 * page is never left.
 */
export function ReplyRow({
  reply: r,
  date,
  timezone,
  done,
}: {
  reply: CampaignReply;
  date: string;
  timezone: string;
  done: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const who = r.organizationName && r.organizationName !== r.contactName ? `${r.contactName} · ${r.organizationName}` : r.contactName;
  return (
    <li className={cn("group relative", open && "bg-surface-2/40")}>
      <div className="flex items-center hover:bg-surface-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title={open ? "Close" : "Read it here"}
          className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5 pl-4 pr-2 text-left active:bg-surface-2 md:flex-row md:items-center md:gap-3 md:py-1.5"
        >
          <span className="flex min-w-0 items-baseline gap-2 md:w-64 md:shrink-0">
            <span className="size-2 shrink-0 self-center rounded-full bg-blue-600" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold md:text-sm">{who}</span>
            <span className="shrink-0 text-[12px] font-semibold text-fg md:hidden" suppressHydrationWarning>
              {date}
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate pl-4 text-[14px] md:pl-0 md:text-sm">
            {r.draftId ? <span className="mr-1.5 font-medium text-red-600 dark:text-red-400">Draft</span> : null}
            <span className="font-semibold text-fg">{r.subject || "(no subject)"}</span>
            <span className="text-muted"> - {r.excerpt.replace(/\s+/g, " ") || "(no text)"}</span>
          </span>
          <span className="hidden w-16 shrink-0 text-right text-xs font-semibold text-fg md:block md:group-hover:invisible" suppressHydrationWarning>
            {date}
          </span>
        </button>
        <form action={done} className="shrink-0 pr-2 md:absolute md:right-2 md:top-0.5 md:hidden md:group-hover:block">
          <button
            type="submit"
            title="Done: hide it until they write again"
            aria-label={`Done with ${r.contactName}'s reply`}
            className="flex size-10 items-center justify-center rounded-full text-muted active:bg-surface-2 md:size-8 md:hover:bg-border/60"
          >
            <Check className="size-[18px] md:size-4" aria-hidden />
          </button>
        </form>
      </div>
      {open ? (
        <div className="flex flex-col gap-3 px-3 pb-3 md:px-4">
          <InlineThread accountId={r.accountId} threadId={r.threadId} />
          {r.draftId ? <DraftHere draftId={r.draftId} timezone={timezone} /> : null}
        </div>
      ) : null}
    </li>
  );
}
