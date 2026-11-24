import { ReplyRow } from "@/components/today/reply-row";
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
 * each (who, subject, what they wrote, date), like Gmail. A row unfolds in
 * place (conversation, Reply, the prepared draft); "Draft" in red means a
 * reply is ready; the check hides it until they write again.
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
        {replies.map((r) => (
          <ReplyRow key={r.contactId} reply={r} date={mailDate(r.sentAt, timezone)} timezone={timezone} done={onDone(r.contactId)} />
        ))}
      </ul>
    </section>
  );
}
