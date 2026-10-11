import Link from "next/link";
import { CalendarClock, Info, Send, TriangleAlert, Users } from "lucide-react";
import { ContactAvatar } from "@/components/contact-avatar";
import { cn } from "@/lib/utils";

/** A mailing (bulk send of a campaign) waiting for the owner's approval, as one flashcard. */
export interface MailingCardData {
  id: string;
  name: string;
  projectName: string | null;
  accountEmail: string;
  /** The account can send (connected, not monitor-only). */
  accountOk: boolean;
  /** Emails "Approve" would start sending. */
  count: number;
  /** Emails held back because the contact got in touch first (checked one by one in the mailing). */
  held: number;
  /** "12 emails from guillermo@…, about 10 an hour, 9:00–19:00 Monday–Friday (Madrid)." */
  plan: string;
  recipients: { contactId: string | null; name: string; org: string | null; photoUrl: string | null; to: string; subject: string }[];
  /** The first email, to read in full. */
  sample: { to: string; subject: string; body: string } | null;
}

/** Front: what goes out and how; the first email in full. Back: every recipient. */
export function MailingFace({ mailing: m, flipped }: { mailing: MailingCardData; flipped: boolean }) {
  return (
    <>
      <header className="flex items-start gap-3 border-b border-border bg-brand/5 px-4 pb-3 pt-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-white">
          <Send className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 text-[16px] font-semibold leading-tight md:text-[15px]">{m.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-fg/80">
              {flipped ? <Info className="size-3.5" aria-hidden /> : <Users className="size-3.5" aria-hidden />}
              {flipped ? "Plan" : `${m.recipients.length} ${m.recipients.length === 1 ? "person" : "people"}`}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] font-medium uppercase tracking-wide text-brand">
            Mailing · {m.count} {m.count === 1 ? "email" : "emails"}
          </p>
          <p className="truncate text-[12px] text-muted">
            {m.projectName ? `${m.projectName} · ` : ""}
            {m.accountEmail}
          </p>
        </div>
      </header>

      {flipped ? (
        <ul className="divide-y divide-border px-4 py-1">
          {m.recipients.map((r, i) => (
            <li key={`${r.to}-${i}`} className="flex items-start gap-2.5 py-2 text-[13px] leading-snug">
              <ContactAvatar contact={{ displayName: r.name, photoUrl: r.photoUrl }} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {r.contactId ? (
                    <Link href={`/contacts/${r.contactId}`} className="hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                  {r.org ? <span className="font-normal text-muted"> · {r.org}</span> : null}
                </span>
                <span className="block truncate text-[12px] text-subtle">
                  {r.to} · {r.subject}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-2.5 px-4 py-3">
          <p className="flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-[12.5px] leading-snug">
            <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <span>{m.plan} Nothing is sent until you approve, and they go out a few at a time.</span>
          </p>
          {!m.accountOk ? (
            <p className="flex items-start gap-2 rounded-md bg-warning/10 px-2.5 py-2 text-[12.5px] text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {m.accountEmail} can&apos;t send right now. Reconnect it in Settings first.
            </p>
          ) : null}
          {m.held ? (
            <p className="text-[12px] text-muted">
              {m.held} held back because they wrote to you first: check them in the mailing.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            {m.recipients.slice(0, 10).map((r, i) => (
              <span key={`${r.to}-${i}`} className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-[12px]">
                <ContactAvatar contact={{ displayName: r.name, photoUrl: r.photoUrl }} size="xs" />
                <span className="truncate">{r.name}</span>
              </span>
            ))}
            {m.recipients.length > 10 ? <span className="text-[12px] text-muted">+{m.recipients.length - 10} more (tap to see all)</span> : null}
          </div>

          {m.sample ? (
            <div className="mt-1 border-t border-border pt-2.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">First email · to {m.sample.to}</p>
              <h2 className="mt-1 text-[15px] font-semibold leading-snug">{m.sample.subject || "(no subject)"}</h2>
              <div className={cn("mt-1 whitespace-pre-wrap text-[13px] leading-[1.45] text-fg md:text-[13.5px]")}>{m.sample.body}</div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
