"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, ListChecks, PenLine, Send, Sparkles } from "lucide-react";
import { queueReplyAction, summarizeThreadAction } from "@/app/(app)/mail/actions";
import type { ThreadSummaryResult } from "@/lib/ai/mail";
import { cn } from "@/lib/utils";
import { useMail, type ComposeInit } from "./mail-provider";

const WAITING: Record<ThreadSummaryResult["waiting_on"], string> = {
  owner: "You",
  them: "Them",
  nobody: "Nobody",
};

/**
 * Claude in the CRM panel: summarize the conversation, write a reply into the
 * composer, or put a reply in the Approvals queue. Nothing is sent from here.
 */
export function ClaudePanel({ accountId, threadId, reply }: { accountId: string; threadId: string; reply: ComposeInit | null }) {
  const { compose } = useMail();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"summary" | "queue" | null>(null);
  const [summary, setSummary] = useState<ThreadSummaryResult | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function summarize() {
    setBusy("summary");
    setError(null);
    try {
      const result = await summarizeThreadAction(accountId, threadId);
      if (result.ok) setSummary(result.summary);
      else setError(result.error);
    } catch {
      setError("Could not reach Claude. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function queue() {
    setBusy("queue");
    setError(null);
    try {
      const result = await queueReplyAction(accountId, threadId, note);
      if (result.ok) setQueued(result.draftId);
      else setError(result.error);
    } catch {
      setError("Could not reach Claude. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Claude" className="rounded-xl border border-border bg-surface md:rounded-lg">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="size-4 text-orange-500" strokeWidth={2} />
        <h2 className="text-[15px] font-medium md:text-sm">Claude</h2>
      </header>
      <div className="flex flex-col gap-3 p-4 md:p-3">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          placeholder="Note for the reply (optional)"
          aria-label="Note for Claude"
          className="h-11 w-full rounded-lg border border-border bg-bg px-3 text-base placeholder:text-subtle focus:border-border-strong focus:outline-none md:h-8 md:rounded-md md:text-sm"
        />
        <div className="grid gap-2">
          <PanelButton onClick={() => void summarize()} busy={busy === "summary"} disabled={busy !== null} icon={ListChecks}>
            Summarize thread
          </PanelButton>
          {reply ? (
            <PanelButton onClick={() => compose({ ...reply, claude: { instructions: note } })} disabled={busy !== null} icon={PenLine} primary>
              Draft reply
            </PanelButton>
          ) : null}
          <PanelButton onClick={() => void queue()} busy={busy === "queue"} disabled={busy !== null || queued !== null} icon={Send}>
            Queue reply for approval
          </PanelButton>
        </div>

        {error ? (
          <p role="alert" className="text-[13px] text-danger md:text-xs">
            {error}
          </p>
        ) : null}

        {queued ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[15px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 md:text-sm">
            Reply queued.{" "}
            <Link href={`/approvals/${queued}`} className="font-medium underline underline-offset-2">
              Review it in Approvals
            </Link>
          </p>
        ) : null}

        {summary ? (
          <div className="flex flex-col gap-2 rounded-lg bg-bg p-3 text-[15px] md:text-sm">
            <p className="leading-relaxed">{summary.summary}</p>
            <p>
              <span className="text-muted">Waiting on: </span>
              <span className={cn("font-medium", summary.waiting_on === "owner" && "text-warning")}>{WAITING[summary.waiting_on]}</span>
            </p>
            {summary.next_step ? (
              <p>
                <span className="text-muted">Next step: </span>
                {summary.next_step}
              </p>
            ) : null}
            {summary.dates.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {summary.dates.map((d) => (
                  <li key={d} className="rounded-md bg-surface-2 px-2 py-0.5 text-[13px] text-muted md:text-xs">
                    {d}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PanelButton({
  onClick,
  busy,
  disabled,
  icon: Icon,
  primary,
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon: typeof Send;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-[15px] font-medium transition-colors disabled:opacity-50 md:h-8 md:justify-start md:rounded-md md:text-sm",
        primary ? "bg-accent text-accent-fg hover:opacity-90" : "border border-border bg-surface hover:bg-surface-2",
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" strokeWidth={1.75} />}
      {children}
    </button>
  );
}
