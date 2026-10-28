import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Paperclip } from "lucide-react";
import { AccountBadge, Badge } from "@/components/ui/badge";
import { formatDateTime, formatRelative } from "@/lib/dates";
import type { Address, EmailMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

function who(address: Address | null | undefined, selfEmails: ReadonlySet<string>): string {
  if (!address) return "Unknown";
  if (selfEmails.has(address.email)) return "You";
  return address.name || address.email;
}

/** A non-email entry interleaved by date (a logged call or note). `node` must render an <li>. */
export interface TimelineExtra {
  key: string;
  at: Date;
  node: ReactNode;
}

/**
 * Chronological email list (newest first; in reading mode oldest first, like Gmail). Each item expands (native
 * <details>, no JS) to show the full stripped body, attachments and a link to
 * the thread in Gmail. Shows every connected account that holds the message.
 * `extra` entries (calls, notes…) are slotted in by date.
 */
export function EmailTimeline({
  messages,
  timezone,
  selfEmails,
  olderHref,
  extra = [],
  emptyText = "No emails yet.",
  reading = false,
}: {
  messages: EmailMessage[];
  timezone: string;
  /** Own addresses, rendered as "You". */
  selfEmails: ReadonlySet<string>;
  /** Link for the next (older) page; omitted when there is none. */
  olderHref?: string | null;
  /** Other entries to interleave by date (newest first or in any order). */
  extra?: TimelineExtra[];
  emptyText?: string;
  /**
   * The conversation to read: every email open, its text first and the rest
   * (who, subject, date) on one small line. Automated mail stays folded.
   */
  reading?: boolean;
}) {
  if (!messages.length && !extra.length) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;

  const entries: ({ type: "email"; at: Date; message: EmailMessage } | ({ type: "extra" } & TimelineExtra))[] = [
    ...messages.map((m) => ({ type: "email" as const, at: m.sentAt, message: m })),
    ...extra.map((e) => ({ type: "extra" as const, ...e })),
  ];
  // Stable: emails keep their order; at the same instant an extra entry sits above.
  if (extra.length) entries.sort((x, y) => y.at.getTime() - x.at.getTime() || (x.type === y.type ? 0 : x.type === "extra" ? -1 : 1));
  // Read like Gmail: oldest at the top, the newest at the bottom (older pages above).
  if (reading) entries.reverse();
  const older = olderHref ? (
    <div className={reading ? "mb-3 text-center" : "mt-3 text-center"}>
      <Link
        href={olderHref}
        className="inline-flex h-11 items-center px-4 text-[15px] text-muted active:opacity-60 md:h-auto md:text-sm md:hover:text-fg"
        scroll={false}
      >
        {reading ? "↑ Older emails" : "Older emails →"}
      </Link>
    </div>
  ) : null;

  return (
    <div>
      {reading ? older : null}
      <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
        {entries.map((entry) => {
          if (entry.type === "extra") return <Fragment key={`x:${entry.key}`}>{entry.node}</Fragment>;
          const m = entry.message;
          const outbound = m.direction === "outbound";
          const Icon = outbound ? ArrowUpRight : ArrowDownLeft;
          const recipients = [...m.to, ...m.cc];
          const toLabel =
            recipients.length === 0
              ? ""
              : `${who(recipients[0], selfEmails)}${recipients.length > 1 ? ` +${recipients.length - 1}` : ""}`;
          if (reading && !m.isAutomated) {
            return (
              <li key={m.id} className={cn("px-3 py-2.5 md:px-4", outbound && "bg-surface-2/40")}>
                <div className="flex items-baseline gap-1.5 text-[11.5px] leading-tight text-subtle">
                  <Icon className="size-3 shrink-0 self-center" strokeWidth={2} aria-label={outbound ? "Sent" : "Received"} />
                  <span className={cn("shrink-0 font-semibold", outbound ? "text-muted" : "text-fg")}>{who(m.from, selfEmails)}</span>
                  {toLabel ? <span className="shrink-0">→ {toLabel}</span> : null}
                  <span className="min-w-0 truncate">· {m.subject || "(no subject)"}</span>
                  {m.hasAttachments ? <Paperclip className="size-3 shrink-0 self-center" aria-label="Has attachments" /> : null}
                  <span className="ml-auto shrink-0 tabular-nums" title={formatDateTime(m.sentAt, timezone)}>
                    {formatDateTime(m.sentAt, timezone)}
                  </span>
                  <Link href={m.gmailUrl} target="_blank" rel="noreferrer" aria-label="Open in Gmail" className="shrink-0 self-center hover:text-fg">
                    <ExternalLink className="size-3" />
                  </Link>
                </div>
                <div className="prose-plain mt-1 text-[14px] leading-snug text-fg md:text-[13.5px]">
                  {m.bodyText || m.snippet || <span className="text-muted">No text content.</span>}
                </div>
                {m.attachments.length ? (
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-subtle">
                    {m.attachments.map((a, i) => (
                      <span key={`${a.filename}-${i}`} className="inline-flex items-center gap-1">
                        <Paperclip className="size-3" />
                        {a.filename}
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            );
          }
          return (
            <li key={m.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none gap-3 px-4 py-3 active:bg-surface-2 md:hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
                  <Icon
                    className={cn("mt-0.5 size-4 shrink-0", outbound ? "text-subtle" : "text-fg")}
                    strokeWidth={1.75}
                    aria-label={outbound ? "Sent" : "Received"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="min-w-0 truncate text-[15px] font-medium text-fg md:text-sm">{who(m.from, selfEmails)}</span>
                      {toLabel ? <span className="min-w-0 truncate text-[13px] text-subtle md:text-xs">→ {toLabel}</span> : null}
                      {m.isAutomated ? <Badge>automated</Badge> : null}
                      {m.hasAttachments ? <Paperclip className="size-3 text-subtle" aria-label="Has attachments" /> : null}
                      <span
                        className="ml-auto shrink-0 text-xs text-subtle"
                        title={formatDateTime(m.sentAt, timezone)}
                      >
                        {formatRelative(m.sentAt, timezone)}
                      </span>
                    </div>
                    <p className={cn("truncate text-[15px] md:text-sm", m.isAutomated ? "text-muted" : "text-fg")}>
                      {m.subject || "(no subject)"}
                    </p>
                    <p className="line-clamp-2 text-[13px] text-muted group-open:hidden md:line-clamp-1 md:text-xs">{m.snippet}</p>
                  </div>
                </summary>
                <div className="border-t border-border bg-bg/40 px-4 py-3 md:pl-11">
                  <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span>{formatDateTime(m.sentAt, timezone)}</span>
                    <span className="text-subtle">·</span>
                    <span>via</span>
                    {m.accounts.map((account) => (
                      <AccountBadge key={account} email={account} />
                    ))}
                    <Link
                      href={m.gmailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-muted hover:text-fg"
                    >
                      Open in Gmail <ExternalLink className="size-3" />
                    </Link>
                  </div>
                  <dl className="mb-3 grid grid-cols-[3rem_1fr] gap-x-2 gap-y-0.5 text-xs">
                    <dt className="text-subtle">From</dt>
                    <dd className="text-muted">{m.from ? formatAddress(m.from) : "—"}</dd>
                    {m.to.length ? (
                      <>
                        <dt className="text-subtle">To</dt>
                        <dd className="text-muted">{m.to.map(formatAddress).join(", ")}</dd>
                      </>
                    ) : null}
                    {m.cc.length ? (
                      <>
                        <dt className="text-subtle">Cc</dt>
                        <dd className="text-muted">{m.cc.map(formatAddress).join(", ")}</dd>
                      </>
                    ) : null}
                  </dl>
                  <div className="prose-plain text-[15px] leading-relaxed text-fg md:text-sm">
                    {m.bodyText || m.snippet || <span className="text-muted">No text content.</span>}
                  </div>
                  {m.attachments.length ? (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {m.attachments.map((a, i) => (
                        <li key={`${a.filename}-${i}`}>
                          <Badge className="font-normal">
                            <Paperclip className="size-3" />
                            {a.filename}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      {reading ? null : older}
    </div>
  );
}

function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}
