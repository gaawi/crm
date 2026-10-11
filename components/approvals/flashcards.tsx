"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, MessageSquareText, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { PostponeForm } from "@/components/assistant/review";
import { VelaLoader } from "@/components/brand/vela-logo";
import { celebrateSend, flourishOrigin } from "@/components/brand/send-flourish";
import { ContactAvatar } from "@/components/contact-avatar";
import { useClaudeEnabled } from "@/components/features";
import { AccountBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { approveDraftAction, discardDraftAction, reviseDraftAction, saveDraftEditsAction, type ActionResult } from "@/lib/ai/actions";
import { postponeAssistantDraftAction, requestAssistantChangesAction } from "@/lib/assistant/actions";
import { ASSISTANT_REVIEW_TIMES } from "@/lib/assistant/types";
import { formatRelative } from "@/lib/dates";
import type { EmailDraft } from "@/lib/types";
import { cn } from "@/lib/utils";

const PURPOSE: Record<EmailDraft["purpose"], string> = {
  reply: "Reply",
  follow_up: "Follow-up",
  nudge: "Nudge",
  outreach: "Outreach",
  other: "Email",
};

type Panel = null | "edit" | "revise" | "changes" | "postpone";

/**
 * Approvals one at a time, like flashcards: the whole email on the card in
 * small, dense type, the actions pinned at the bottom. Swipe (or ← →) to move
 * between cards; approving, discarding, postponing or asking for changes
 * takes the card off the pile and shows the next. Approve needs two taps.
 */
export function Flashcards({ drafts, timezone, today, startId }: { drafts: EmailDraft[]; timezone: string; today: string; startId?: string | null }) {
  const claude = useClaudeEnabled();
  const [done, setDone] = useState<Record<string, string>>({});
  const pile = useMemo(() => drafts.filter((d) => !done[d.id] && d.status !== "sent" && d.status !== "discarded"), [drafts, done]);
  const [currentId, setCurrentId] = useState<string | null>(() => (startId && drafts.some((d) => d.id === startId) ? startId : (drafts[0]?.id ?? null)));
  const found = pile.findIndex((d) => d.id === currentId);
  const index = found >= 0 ? found : pile.length ? 0 : -1;
  const draft = index >= 0 ? pile[index] : null;
  const [panel, setPanel] = useState<Panel>(null);
  const [armed, setArmed] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const go = useCallback(
    (delta: number) => {
      if (!pile.length) return;
      const next = pile[(index + delta + pile.length) % pile.length];
      setCurrentId(next.id);
      setPanel(null);
      setArmed(false);
      setMessage(null);
      window.scrollTo({ top: 0 });
    },
    [pile, index],
  );

  /** The card leaves the pile; the next one (or the previous, at the end) takes its place. */
  const finish = (id: string, label: string) => {
    const at = pile.findIndex((d) => d.id === id);
    const next = pile[at + 1] ?? pile[at - 1] ?? null;
    setCurrentId(next?.id ?? null);
    setDone((prev) => ({ ...prev, [id]: label }));
    setPanel(null);
    setArmed(false);
    setMessage({ tone: "ok", text: label });
    window.scrollTo({ top: 0 });
  };

  const run = (action: () => Promise<ActionResult>, onOk: (r: ActionResult) => void) =>
    startTransition(async () => {
      const r = await action();
      if (r.ok) onOk(r);
      else setMessage({ tone: "error", text: r.error ?? "Something went wrong." });
    });

  // Keyboard: ← → move, Escape closes a panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select") || e.target.isContentEditable);
      if (e.key === "Escape" && panel) setPanel(null);
      if (typing || panel) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, panel]);

  // Horizontal swipe on the card (vertical scrolling stays native).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  const onTouchStart = (e: React.TouchEvent) => {
    if (panel) return;
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const x = e.touches[0].clientX - touch.current.x;
    const y = e.touches[0].clientY - touch.current.y;
    if (Math.abs(x) > Math.abs(y) * 1.4) setDx(x);
  };
  const onTouchEnd = () => {
    if (Math.abs(dx) > 80) go(dx < 0 ? 1 : -1);
    setDx(0);
    touch.current = null;
  };

  if (!draft) {
    const count = Object.keys(done).length;
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <Check className="size-7" />
        </span>
        <h1 className="text-xl font-semibold">{count ? "All reviewed" : "Nothing to approve"}</h1>
        <p className="text-[15px] text-muted md:text-sm">
          {count ? `You went through ${count} ${count === 1 ? "email" : "emails"}.` : "No emails are waiting for your approval."}
        </p>
        <Link href="/approvals" className="text-[15px] text-brand underline-offset-2 hover:underline md:text-sm">
          Back to Approvals
        </Link>
      </div>
    );
  }

  const assistantFlow = Boolean(draft.assistantProjectId) && !draft.campaignId;
  const busy = pending || draft.status === "sending" || draft.status === "revising";
  const reason = draft.assistantReason ?? draft.rationale;
  const org = draft.organization;
  const tagline = org?.profile?.tagline;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      {/* Top bar: back, position, arrows */}
      <div className="sticky top-0 z-20 -mx-4 bg-bg/90 px-4 pb-2 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:static md:mx-0 md:bg-transparent md:px-0 md:pt-0 md:backdrop-blur-none">
        <div className="flex h-11 items-center gap-1">
          <Link href="/approvals" className="flex h-11 items-center pr-2 text-[17px] text-blue-600 active:opacity-50 md:text-sm dark:text-blue-400">
            <ChevronLeft className="size-6 md:size-4" /> Approvals
          </Link>
          <span className="flex-1 text-center text-[13px] tabular-nums text-muted">
            {index + 1} of {pile.length}
          </span>
          <button type="button" onClick={() => go(-1)} aria-label="Previous email" className="flex size-11 items-center justify-center rounded-full text-muted active:bg-surface-2 md:size-8">
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next email" className="flex size-11 items-center justify-center rounded-full text-muted active:bg-surface-2 md:size-8">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300"
            style={{ width: `${((Object.keys(done).length + index + 1) / (Object.keys(done).length + pile.length)) * 100}%` }}
          />
        </div>
      </div>

      {message ? (
        <p role="status" className={cn("mt-2 rounded-lg px-3 py-2 text-[13px]", message.tone === "ok" ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
          {message.text}
        </p>
      ) : null}

      <article
        key={draft.id}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: "none" } : undefined}
        className="mt-2 min-w-0 rounded-2xl border border-border bg-surface shadow-sm transition-transform duration-200 [overflow-wrap:anywhere]"
      >
        <header className="flex items-start gap-3 border-b border-border px-4 pb-3 pt-3.5">
          {draft.contact ? <ContactAvatar contact={draft.contact} size="md" /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-tight md:text-[15px]">
                {draft.contact ? (
                  <Link href={`/contacts/${draft.contact.id}`} className="hover:underline">
                    {draft.contact.displayName}
                  </Link>
                ) : (
                  draft.to.join(", ")
                )}
              </span>
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-subtle">{PURPOSE[draft.purpose]}</span>
            </div>
            {org ? (
              <p className="truncate text-[12px] text-muted">
                {org.name}
                {tagline ? ` · ${tagline}` : ""}
              </p>
            ) : null}
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-subtle">
              <AccountBadge email={draft.accountEmail} />
              <span>{formatRelative(draft.updatedAt, timezone)}</span>
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-2 px-4 py-3">
          {reason ? (
            <p className="rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px] leading-snug text-muted">
              <Sparkles className="mr-1 inline size-3 align-[-1px]" aria-hidden />
              {reason}
            </p>
          ) : null}
          {draft.error ? <p className="rounded-md bg-warning/10 px-2.5 py-1.5 text-[12px] text-warning">{draft.error}</p> : null}
          <p className="text-[11.5px] leading-snug text-subtle">
            To {draft.to.join(", ")}
            {draft.cc.length ? ` · Cc ${draft.cc.join(", ")}` : ""}
            {draft.replyToSubject ? ` · in reply to “${draft.replyToSubject}”` : ""}
          </p>
          <h2 className="text-[15px] font-semibold leading-snug">{draft.subject || "(no subject)"}</h2>
          <div className="whitespace-pre-wrap text-[13px] leading-[1.45] text-fg md:text-[13.5px]">{draft.body}</div>
        </div>
      </article>

      {/* Room for the action bar */}
      <div className="h-40 md:h-6" aria-hidden />

      {/* Action panels and bar, pinned above the tab bar on phones */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-30 px-3 md:static md:bottom-auto md:px-0">
        <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-surface/95 p-2 shadow-[0_8px_30px_rgba(0,0,0,0.15)] backdrop-blur-xl md:sticky md:bottom-4 md:shadow-md">
          {panel === "edit" ? (
            <form
              className="flex flex-col gap-2 p-1"
              action={(formData) => run(() => saveDraftEditsAction(draft.id, formData), () => { setPanel(null); setMessage({ tone: "ok", text: "Saved." }); })}
            >
              <Input name="to" defaultValue={draft.to.join(", ")} aria-label="To" placeholder="To" />
              <Input name="cc" defaultValue={draft.cc.join(", ")} aria-label="Cc" placeholder="Cc" />
              <Input name="subject" defaultValue={draft.subject} aria-label="Subject" placeholder="Subject" />
              <Textarea name="body" defaultValue={draft.body} rows={9} aria-label="Message" className="text-[13px] leading-snug" />
              <PanelButtons pending={pending} onCancel={() => setPanel(null)} submit="Save" />
            </form>
          ) : panel === "revise" || panel === "changes" ? (
            <NoteForm
              key={panel}
              label={panel === "changes" ? `What should change? The assistant rewrites it in its next review (${ASSISTANT_REVIEW_TIMES}).` : "Tell Claude what to change"}
              submit={panel === "changes" ? "Send to assistant" : "Rewrite"}
              pending={pending}
              onCancel={() => setPanel(null)}
              onSubmit={(text) =>
                panel === "changes"
                  ? run(() => requestAssistantChangesAction(draft.id, text), () => finish(draft.id, "Sent to the assistant."))
                  : run(() => reviseDraftAction(draft.id, text), () => { setPanel(null); setMessage({ tone: "ok", text: "Rewritten." }); })
              }
            />
          ) : panel === "postpone" ? (
            <div className="p-1">
              <PostponeForm
                today={today}
                pending={pending}
                onCancel={() => setPanel(null)}
                onSubmit={(date) => run(() => postponeAssistantDraftAction(draft.id, date), () => finish(draft.id, "Postponed."))}
              />
            </div>
          ) : (
            <div className="flex items-stretch gap-1">
              <IconAction label="Discard" tone="danger" disabled={busy} onClick={() => run(() => discardDraftAction(draft.id), () => finish(draft.id, "Discarded."))}>
                <Trash2 className="size-5" />
              </IconAction>
              {assistantFlow ? (
                <IconAction label="Postpone" disabled={busy} onClick={() => setPanel("postpone")}>
                  <CalendarClock className="size-5" />
                </IconAction>
              ) : null}
              {assistantFlow ? (
                <IconAction label="Changes" disabled={busy} onClick={() => setPanel("changes")}>
                  <MessageSquareText className="size-5" />
                </IconAction>
              ) : claude ? (
                <IconAction label="Change" disabled={busy} onClick={() => setPanel("revise")}>
                  <Sparkles className="size-5" />
                </IconAction>
              ) : null}
              <IconAction label="Edit" disabled={busy} onClick={() => setPanel("edit")}>
                <Pencil className="size-5" />
              </IconAction>
              <button
                type="button"
                disabled={busy}
                onClick={(event) => {
                  if (!armed) {
                    setArmed(true);
                    return;
                  }
                  setArmed(false);
                  const origin = flourishOrigin(event.currentTarget);
                  const id = draft.id;
                  run(() => approveDraftAction(id), () => {
                    celebrateSend(origin);
                    finish(id, "Sent.");
                  });
                }}
                className={cn(
                  "flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 text-[15px] font-semibold text-white transition-colors active:opacity-80 disabled:opacity-60",
                  armed ? "bg-success" : "bg-brand",
                )}
              >
                {pending && armed ? (
                  <>
                    <VelaLoader size={16} label="Sending" className="text-current" /> Sending…
                  </>
                ) : armed ? (
                  <span className="text-[14px]">Tap again to send</span>
                ) : (
                  <>
                    <Check className="size-5 shrink-0" /> Approve<span className="hidden md:inline"> & send</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex min-h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium active:bg-surface-2 disabled:opacity-50 md:w-16 md:hover:bg-surface-2",
        tone === "danger" ? "text-danger" : "text-muted",
      )}
    >
      {children}
      {label}
    </button>
  );
}

function NoteForm({
  label,
  submit,
  pending,
  onCancel,
  onSubmit,
}: {
  label: string;
  submit: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex flex-col gap-2 p-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
    >
      <label htmlFor="flashcard-note" className="text-[12px] text-muted">
        {label}
      </label>
      <Textarea
        id="flashcard-note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Shorter, mention the October dates, write it in Spanish…"
        autoFocus
        required
      />
      <PanelButtons pending={pending} onCancel={onCancel} submit={submit} disabled={!text.trim()} />
    </form>
  );
}

function PanelButtons({ pending, onCancel, submit, disabled }: { pending: boolean; onCancel: () => void; submit: string; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
        <X className="size-4" /> Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={pending || disabled}>
        {pending ? <VelaLoader size={16} label="Working" className="text-current" /> : null}
        {submit}
      </Button>
    </div>
  );
}
