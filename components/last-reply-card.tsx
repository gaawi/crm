import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, MessageSquareQuote } from "lucide-react";
import { AccountBadge } from "@/components/ui/badge";
import { formatDate, formatRelative } from "@/lib/dates";
import type { LastReply } from "@/lib/queries/last-reply";
import { truncate } from "@/lib/utils";

/**
 * "Their last reply": the last real email they wrote to us, highlighted at the
 * top of a contact or organization, with our answer after it (if any) below in
 * a quieter line.
 */
export function LastReplyCard({ reply, timezone, showSender = false }: { reply: LastReply | null; timezone: string; showSender?: boolean }) {
  if (!reply) return null;
  const { theirs, ours } = reply;
  const sender = theirs.fromName?.trim() || theirs.fromEmail;
  return (
    <section aria-label="Their last reply" className="mb-6 overflow-hidden rounded-xl border-2 border-emerald-400 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-950/20">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-emerald-200 px-4 py-2 text-[13px] dark:border-emerald-900">
        <MessageSquareQuote className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
        <span className="font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Their last reply</span>
        <span className="text-muted">
          {formatRelative(new Date(theirs.sentAt), timezone)} · {formatDate(theirs.sentAt, timezone)}
        </span>
      </header>
      <div className="px-4 py-3">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted">
          <ArrowDownLeft className="size-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden />
          {showSender || sender !== theirs.fromEmail ? <span className="font-semibold text-fg">{sender}</span> : null}
          <span>{theirs.fromEmail}</span>
          <span>to</span>
          <AccountBadge email={theirs.accountEmail} />
        </p>
        {theirs.subject ? <p className="mt-1 text-[15px] font-semibold text-fg md:text-sm">{theirs.subject}</p> : null}
        <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed text-fg md:text-sm">{theirs.text || "(no text)"}</p>
        <Link
          href={`/mail/t/${theirs.accountId}/${encodeURIComponent(theirs.threadId)}`}
          className="mt-2 inline-block text-[13px] font-medium text-emerald-800 hover:underline dark:text-emerald-300"
        >
          Open the conversation
        </Link>
      </div>
      {ours ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-emerald-200 bg-surface/60 px-4 py-2 text-[12px] text-muted dark:border-emerald-900">
          <ArrowUpRight className="size-3.5" aria-hidden />
          <span>We answered {formatDate(ours.sentAt, timezone)} from</span>
          <AccountBadge email={ours.accountEmail} />
          {ours.text ? <span className="min-w-0 truncate italic">“{truncate(ours.text.replace(/\s+/g, " "), 140)}”</span> : null}
        </p>
      ) : (
        <p className="border-t border-emerald-200 bg-amber-50/70 px-4 py-2 text-[12px] font-medium text-amber-800 dark:border-emerald-900 dark:bg-amber-950/30 dark:text-amber-300">
          We haven&apos;t answered this email yet.
        </p>
      )}
    </section>
  );
}
