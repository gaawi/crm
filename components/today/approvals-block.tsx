import Link from "next/link";
import {
  ChevronRight,
  Hourglass,
  Layers,
  Send,
} from "lucide-react";
import { LaterPile, PostponePile } from "./postpone-pile";
import { ContactAvatar } from "@/components/contact-avatar";
import { draftsBySheet, type PendingApprovals } from "@/lib/approvals/pending";

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Top of Today: everything waiting for the owner's OK. Mass mailings (many
 * emails approved at once) come first, in red, each opening its full list;
 * single emails are reviewed one by one as flashcards (blue), one pile per
 * booking sheet (European partners, Booking USA...) and "Other" for the rest.
 */
export function ApprovalsBlock({ pending }: { pending: PendingApprovals }) {
  const { drafts, mailings, waitingVersion, total, postponed } = pending;
  if (!total && !waitingVersion && !postponed.length) return null;
  const groups = draftsBySheet(drafts);
  const later = draftsBySheet(postponed);

  return (
    <section aria-label="To approve" className="flex flex-col gap-2">
      {mailings.map((m) => (
        <Link
          key={m.id}
          href={`/approvals/mailings/${m.id}`}
          className="flex items-center gap-3 rounded-2xl bg-red-600 px-4 py-4 text-white shadow-sm active:opacity-90 md:rounded-xl md:py-3.5 md:hover:opacity-95 dark:bg-red-700"
        >
          <Send className="size-6 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-white/80">
              Mass mailing · approve all at once
            </span>
            <span className="block truncate text-[17px] font-semibold leading-tight md:text-[15px]">
              {m.name}
            </span>
            <span className="block truncate text-[13px] text-white/85">
              {plural(m.count, "email")} from {m.accountEmail} · read them all
              before approving
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0" aria-hidden />
        </Link>
      ))}
      {groups.map((g, i) => (
        <div key={g.key} className="flex items-stretch gap-2">
          <Link
            href={`/approvals/review?sheet=${g.key}`}
            // The first pile is downloaded in full while Today is open: its cards open at once.
            prefetch={i === 0}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-brand px-4 py-4 text-white shadow-sm active:opacity-90 md:rounded-xl md:py-3.5 md:hover:opacity-95"
          >
            <Layers className="size-6 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-white/80">
                {g.name}
              </span>
              <span className="block text-[17px] font-semibold leading-tight md:text-[15px]">
                {g.drafts.length === 1
                  ? "1 email to approve"
                  : `${g.drafts.length} emails to approve`}
              </span>
            </span>
            {g.faces.length ? (
              <span className="hidden shrink-0 -space-x-2 sm:flex" aria-hidden>
                {g.faces.map((c) => (
                  <ContactAvatar
                    key={c.id}
                    contact={c}
                    size="sm"
                    className="ring-2 ring-brand"
                  />
                ))}
              </span>
            ) : null}
            <ChevronRight className="size-5 shrink-0" aria-hidden />
          </Link>
          <PostponePile ids={g.drafts.map((d) => d.id)} name={g.name} />
        </div>
      ))}
      {later.length ? (
        <div className="flex flex-col gap-1.5">
          {later.map((g) => (
            <LaterPile key={g.key} ids={g.drafts.map((d) => d.id)} name={g.name} until={g.until} />
          ))}
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[13px] text-muted md:text-xs">
        {waitingVersion ? (
          <span className="inline-flex items-center gap-1">
            <Hourglass className="size-3.5" aria-hidden />
            {plural(waitingVersion, "email")} waiting for the assistant&apos;s
            new version
          </span>
        ) : null}
        <Link
          href="/approvals"
          className="underline-offset-2 hover:text-fg hover:underline"
        >
          See as a list
        </Link>
      </p>
    </section>
  );
}
