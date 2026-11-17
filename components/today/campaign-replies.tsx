import Link from "next/link";
import { Check, CornerUpLeft, MessageSquareQuote } from "lucide-react";
import { formatRelative } from "@/lib/dates";
import type { CampaignReply } from "@/lib/queries/campaign-replies";

/**
 * Top of Today: campaign contacts who answered and are waiting for us, with
 * what they wrote. "Reply" opens the conversation; the check hides it until
 * they write again.
 */
export function CampaignRepliesBlock({
  replies,
  timezone,
  onDone,
  limit = 6,
}: {
  replies: CampaignReply[];
  timezone: string;
  onDone: (contactId: string) => () => Promise<void>;
  limit?: number;
}) {
  if (!replies.length) return null;
  const shown = replies.slice(0, limit);
  return (
    <section aria-label="They replied">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        <MessageSquareQuote className="size-4" aria-hidden />
        They replied
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white">
          {replies.length}
        </span>
      </h2>
      <ul className="flex flex-col gap-2">
        {shown.map((r) => (
          <li key={r.contactId} className="overflow-hidden rounded-xl border border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20 md:rounded-lg">
            <div className="px-4 pb-2 pt-3">
              <div className="flex items-baseline gap-2">
                <Link href={`/contacts/${r.contactId}`} className="min-w-0 flex-1 truncate text-[16px] font-semibold active:opacity-60 md:text-sm md:hover:underline">
                  {r.contactName}
                  {r.organizationName && r.organizationName !== r.contactName ? (
                    <span className="font-normal text-muted"> · {r.organizationName}</span>
                  ) : null}
                </Link>
                <span className="shrink-0 text-[13px] text-subtle md:text-xs">{formatRelative(new Date(r.sentAt), timezone)}</span>
              </div>
              <p className="truncate text-[13px] text-muted md:text-xs">{r.projectName}</p>
              <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-[15px] leading-snug text-fg md:text-sm">{r.excerpt || r.subject || "(no text)"}</p>
            </div>
            <div className="flex items-center border-t border-emerald-200 dark:border-emerald-900">
              <Link
                href={`/mail/t/${r.accountId}/${encodeURIComponent(r.threadId)}`}
                className="flex min-h-11 flex-1 items-center justify-center gap-1.5 text-[15px] font-medium text-emerald-800 active:bg-emerald-100/60 md:min-h-9 md:text-sm md:hover:bg-emerald-100/60 dark:text-emerald-300 dark:active:bg-emerald-900/30"
              >
                <CornerUpLeft className="size-4" aria-hidden /> Reply
              </Link>
              <form action={onDone(r.contactId)} className="border-l border-emerald-200 dark:border-emerald-900">
                <button
                  type="submit"
                  title="Done: hide it until they write again"
                  aria-label={`Done with ${r.contactName}'s reply`}
                  className="flex min-h-11 items-center gap-1.5 px-4 text-[15px] text-muted active:bg-emerald-100/60 md:min-h-9 md:text-sm md:hover:bg-emerald-100/60 dark:active:bg-emerald-900/30"
                >
                  <Check className="size-4" aria-hidden /> Done
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      {replies.length > shown.length ? (
        <p className="mt-2 text-[13px] text-muted md:text-xs">
          And {replies.length - shown.length} more below, under Needs your reply.
        </p>
      ) : null}
    </section>
  );
}
