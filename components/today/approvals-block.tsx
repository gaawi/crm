import Link from "next/link";
import { ChevronRight, Hourglass, Layers, Send } from "lucide-react";
import { ContactAvatar } from "@/components/contact-avatar";
import type { PendingApprovals } from "@/lib/approvals/pending";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Top of Today: everything waiting for the owner's OK (single emails and
 * mailings), opened as flashcards. Approvals has no tab of its own any more.
 */
export function ApprovalsBlock({ pending }: { pending: PendingApprovals }) {
  const { drafts, mailings, waitingVersion, total } = pending;
  if (!total && !waitingVersion) return null;
  const parts = [mailings.length ? plural(mailings.length, "mailing") : "", drafts.length ? plural(drafts.length, "email") : ""].filter(Boolean);
  const faces = drafts.flatMap((d) => (d.contact ? [d.contact] : [])).slice(0, 5);

  return (
    <section aria-label="To approve" className="flex flex-col gap-2">
      {total ? (
        <Link
          href="/approvals/review"
          className="flex items-center gap-3 rounded-2xl bg-brand px-4 py-4 text-white shadow-sm active:opacity-90 md:rounded-xl md:py-3.5 md:hover:opacity-95"
        >
          <Layers className="size-6 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold leading-tight md:text-[15px]">
              {total === 1 ? "1 to approve" : `${total} to approve`}
            </span>
            <span className="block truncate text-[13px] text-white/80">
              {parts.join(" · ")} · review them one by one
            </span>
          </span>
          {faces.length ? (
            <span className="hidden shrink-0 -space-x-2 sm:flex" aria-hidden>
              {faces.map((c) => (
                <ContactAvatar key={c.id} contact={c} size="sm" className="ring-2 ring-brand" />
              ))}
            </span>
          ) : mailings.length ? (
            <Send className="size-5 shrink-0 opacity-80" aria-hidden />
          ) : null}
          <ChevronRight className="size-5 shrink-0" aria-hidden />
        </Link>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[13px] text-muted md:text-xs">
        {waitingVersion ? (
          <span className="inline-flex items-center gap-1">
            <Hourglass className="size-3.5" aria-hidden />
            {plural(waitingVersion, "email")} waiting for the assistant&apos;s new version
          </span>
        ) : null}
        <Link href="/approvals" className="underline-offset-2 hover:text-fg hover:underline">
          See as a list
        </Link>
      </p>
    </section>
  );
}
