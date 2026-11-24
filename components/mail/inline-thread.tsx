"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, Reply } from "lucide-react";
import { inlineThreadAction } from "@/app/(app)/mail/inline-actions";
import { useMail } from "@/components/mail/mail-provider";
import { composeFor } from "@/components/mail/reply-init";
import type { ThreadViewData } from "@/components/mail/thread-types";
import { cn } from "@/lib/utils";

function when(iso: string | Date, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * A conversation read in place, where the person already is (a campaign
 * row's panel, Today, a contact): the messages, the newest open, and Reply,
 * which opens the composer right here. "Open in Mail" is there for the rare
 * case the whole mail view is wanted.
 */
export function InlineThread({
  accountId,
  threadId,
  autoReply = false,
  className,
}: {
  accountId: string;
  threadId: string;
  /** Open the reply as soon as the conversation is loaded ("Reply" was pressed). */
  autoReply?: boolean;
  className?: string;
}) {
  const { compose, ownAddresses, timezone, accounts } = useMail();
  const [thread, setThread] = useState<ThreadViewData | null | undefined>(undefined);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const own = useMemo(() => new Set(ownAddresses), [ownAddresses]);
  const replied = useRef(false);

  useEffect(() => {
    let live = true;
    inlineThreadAction(accountId, threadId).then(
      (t) => {
        if (!live) return;
        setThread(t);
        if (t?.messages.length) setOpen(new Set([t.messages[t.messages.length - 1].id]));
      },
      () => live && setThread(null),
    );
    return () => {
      live = false;
    };
  }, [accountId, threadId]);

  const latest = thread?.messages[thread.messages.length - 1];
  const readOnly = accounts.find((a) => a.id === accountId)?.monitorOnly ?? false;
  const reply = () => {
    if (thread && latest && !readOnly) compose(composeFor("reply", thread, latest, own, timezone));
  };
  useEffect(() => {
    if (!autoReply || replied.current || !thread || !latest || readOnly) return;
    replied.current = true;
    compose(composeFor("reply", thread, latest, own, timezone));
  }, [autoReply, thread, latest, readOnly, compose, own, timezone]);

  const mailHref = `/mail/t/${accountId}/${encodeURIComponent(threadId)}`;
  if (thread === undefined) {
    return (
      <p className={cn("flex items-center gap-1.5 py-2 text-[13px] text-muted md:text-xs", className)}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading the conversation…
      </p>
    );
  }
  if (!thread) {
    return (
      <p className={cn("py-2 text-[13px] text-muted md:text-xs", className)}>
        This conversation isn&apos;t stored yet.{" "}
        <Link href={mailHref} className="text-blue-600 underline dark:text-blue-400">
          Open in Mail
        </Link>
      </p>
    );
  }
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)} onClick={(e) => e.stopPropagation()}>
      {thread.subject ? <p className="border-b border-border px-3 py-2 text-[14px] font-semibold md:text-sm">{thread.subject}</p> : null}
      <ol className="divide-y divide-border">
        {thread.messages.map((m) => {
          const isOpen = open.has(m.id);
          const who = m.outbound ? "You" : (m.from?.name ?? m.from?.email ?? "Unknown");
          return (
            <li key={m.id}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.id)) next.delete(m.id);
                    else next.add(m.id);
                    return next;
                  })
                }
                className="flex w-full items-baseline gap-2 px-3 pt-2 text-left active:bg-surface-2 md:hover:bg-surface-2/60"
              >
                <span className={cn("min-w-0 shrink-0 truncate text-[14px] md:text-sm", m.outbound ? "text-muted" : "font-semibold")}>{who}</span>
                {!isOpen ? <span className="min-w-0 flex-1 truncate text-[13px] text-muted md:text-xs">{m.snippet}</span> : <span className="flex-1" />}
                <span className="shrink-0 text-[12px] text-subtle md:text-[11px]" suppressHydrationWarning>
                  {when(m.date, timezone)}
                </span>
              </button>
              {isOpen ? (
                <div className="px-3 pb-3 pt-1">
                  {!m.outbound && m.from?.email ? <p className="mb-1.5 text-[12px] text-subtle md:text-[11px]">{m.from.email}</p> : null}
                  <p className="whitespace-pre-line text-[14px] leading-relaxed text-fg [overflow-wrap:anywhere] md:text-sm">
                    {m.textWithoutQuotes || m.snippet || "(no text)"}
                  </p>
                </div>
              ) : (
                <div className="pb-2" />
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        {!readOnly ? (
          <button
            type="button"
            onClick={reply}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-[14px] font-medium active:bg-surface-2 md:h-8 md:text-sm md:hover:bg-surface-2"
          >
            <Reply className="size-4" aria-hidden /> Reply
          </button>
        ) : (
          <span className="text-[12px] text-muted md:text-xs">Monitor-only mailbox: reply from your own account.</span>
        )}
        <Link href={mailHref} className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted active:opacity-60 md:text-xs md:hover:text-fg">
          <ExternalLink className="size-3.5" aria-hidden /> Open in Mail
        </Link>
      </div>
    </div>
  );
}

/**
 * "Show conversation" and "Reply" for a page built on the server (a contact,
 * an organization): unfolds the conversation under it, never leaves the page.
 */
export function ThreadToggle({ accountId, threadId, className }: { accountId: string; threadId: string; className?: string }) {
  const [mode, setMode] = useState<null | "read" | "reply">(null);
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setMode("reply")}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-[14px] font-medium active:bg-surface-2 md:h-8 md:text-sm md:hover:bg-surface-2"
        >
          <Reply className="size-4" aria-hidden /> Reply
        </button>
        <button
          type="button"
          aria-expanded={mode !== null}
          onClick={() => setMode(mode ? null : "read")}
          className="text-[13px] font-medium text-emerald-800 hover:underline dark:text-emerald-300"
        >
          {mode ? "Hide the conversation" : "Show the conversation"}
        </button>
      </div>
      {mode ? <InlineThread key={mode} accountId={accountId} threadId={threadId} autoReply={mode === "reply"} className="mt-2" /> : null}
    </div>
  );
}
