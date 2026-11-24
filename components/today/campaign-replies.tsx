import Link from "next/link";
import { Check } from "lucide-react";
import type { CampaignReply } from "@/lib/queries/campaign-replies";

/** Gmail's dates: the time for today, "Nov 20" this year, "11/20/25" before. */
function mailDate(iso: string, timezone: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => x.toLocaleDateString("en-US", { timeZone: timezone });
  if (day(d) === day(now)) return d.toLocaleTimeString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
  const year = (x: Date) => x.toLocaleDateString("en-US", { timeZone: timezone, year: "numeric" });
  if (year(d) === year(now)) return d.toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { timeZone: timezone, month: "numeric", day: "numeric", year: "2-digit" });
}

/**
 * Campaign contacts who answered and are waiting for us, as an inbox: one line
 * each (who, subject, what they wrote, date), like Gmail. A row opens the
 * conversation; "Draft" in red means a reply is ready in Approvals; the check
 * hides it until they write again.
 */
export function CampaignRepliesBlock({
  replies,
  timezone,
  onDone,
}: {
  replies: CampaignReply[];
  timezone: string;
  onDone: (contactId: string) => () => Promise<void>;
}) {
  if (!replies.length) return null;
  return (
    <section aria-label="They replied">
      <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        They replied
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fg px-1.5 text-[11px] font-semibold text-bg">{replies.length}</span>
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
        {replies.map((r) => {
          const who = r.organizationName && r.organizationName !== r.contactName ? `${r.contactName} · ${r.organizationName}` : r.contactName;
          return (
            <li key={r.contactId} className="group relative flex items-center hover:bg-surface-2">
              <Link
                href={r.draftId ? `/approvals/${r.draftId}` : `/mail/t/${r.accountId}/${encodeURIComponent(r.threadId)}`}
                title={r.draftId ? "A reply is drafted: open it to review and send" : "Open the conversation"}
                className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5 pl-4 pr-2 active:bg-surface-2 md:flex-row md:items-center md:gap-3 md:py-1.5"
              >
                <span className="flex min-w-0 items-baseline gap-2 md:w-64 md:shrink-0">
                  <span className="size-2 shrink-0 self-center rounded-full bg-blue-600" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold md:text-sm">{who}</span>
                  <span className="shrink-0 text-[12px] font-semibold text-fg md:hidden" suppressHydrationWarning>
                    {mailDate(r.sentAt, timezone)}
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate pl-4 text-[14px] md:pl-0 md:text-sm">
                  {r.draftId ? <span className="mr-1.5 font-medium text-red-600 dark:text-red-400">Draft</span> : null}
                  <span className="font-semibold text-fg">{r.subject || "(no subject)"}</span>
                  <span className="text-muted"> - {r.excerpt.replace(/\s+/g, " ") || "(no text)"}</span>
                </span>
                <span className="hidden w-16 shrink-0 text-right text-xs font-semibold text-fg md:block md:group-hover:invisible" suppressHydrationWarning>
                  {mailDate(r.sentAt, timezone)}
                </span>
              </Link>
              <form action={onDone(r.contactId)} className="shrink-0 pr-2 md:absolute md:right-2 md:hidden md:group-hover:block">
                <button
                  type="submit"
                  title="Done: hide it until they write again"
                  aria-label={`Done with ${r.contactName}'s reply`}
                  className="flex size-10 items-center justify-center rounded-full text-muted active:bg-surface-2 md:size-8 md:hover:bg-border/60"
                >
                  <Check className="size-[18px] md:size-4" aria-hidden />
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
