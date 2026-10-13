"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, Info, Mail, MessageSquareText, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { PostponeForm } from "@/components/assistant/review";
import { VelaLoader } from "@/components/brand/vela-logo";
import { celebrateSend, flourishOrigin } from "@/components/brand/send-flourish";
import { ContactAvatar } from "@/components/contact-avatar";
import { useClaudeEnabled } from "@/components/features";
import { AccountBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { approveDraftAction, discardDraftAction, reviseDraftAction, saveDraftEditsAction } from "@/lib/ai/actions";
import { postponeAssistantDraftAction, requestAssistantChangesAction } from "@/lib/assistant/actions";
import { ASSISTANT_REVIEW_TIMES } from "@/lib/assistant/types";
import { formatRelative } from "@/lib/dates";
import type { EmailDraft } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CardBack } from "./card-back";
import { loadCardInfo, loadDraftThread, type CardInfo, type DraftThread } from "./card-info";
import { MailingFace, type MailingCardData } from "./mailing-card";
import { DraftConversation } from "./thread-face";
import { discardCampaignAction, startCampaignAction } from "@/app/(app)/approvals/actions";

const PURPOSE: Record<EmailDraft["purpose"], string> = {
  reply: "Reply",
  follow_up: "Follow-up",
  nudge: "Nudge",
  outreach: "Outreach",
  other: "Email",
};

/** How long a card takes to slide out (and the next one to slide in). */
const SLIDE_MS = 200;

type Panel = null | "edit" | "revise" | "changes" | "postpone";

/** A card of the pile: one email, or a whole mailing (bulk send) approved at once. */
type Item = { kind: "draft"; id: string; draft: EmailDraft } | { kind: "mailing"; id: string; mailing: MailingCardData };

/**
 * Approvals one at a time, like flashcards: the whole email on the card in
 * small, dense type, the actions pinned at the bottom. Swipe (or ← →) to move
 * between cards; approving, discarding, postponing or asking for changes
 * takes the card off the pile and shows the next. Approve needs two taps.
 */
export function Flashcards({
  drafts,
  mailings = [],
  timezone,
  today,
  startId,
}: {
  drafts: EmailDraft[];
  mailings?: MailingCardData[];
  timezone: string;
  today: string;
  startId?: string | null;
}) {
  const claude = useClaudeEnabled();
  const [done, setDone] = useState<Record<string, string>>({});
  // Mailings first: one card approves many emails.
  const all = useMemo<Item[]>(
    () => [
      ...mailings.map((m) => ({ kind: "mailing" as const, id: `mailing:${m.id}`, mailing: m })),
      ...drafts.filter((d) => d.status !== "sent" && d.status !== "discarded").map((d) => ({ kind: "draft" as const, id: d.id, draft: d })),
    ],
    [drafts, mailings],
  );
  const pile = useMemo(() => all.filter((i) => !done[i.id]), [all, done]);
  const [currentId, setCurrentId] = useState<string | null>(() => (startId && all.some((i) => i.id === startId) ? startId : (all[0]?.id ?? null)));
  const found = pile.findIndex((i) => i.id === currentId);
  const index = found >= 0 ? found : pile.length ? 0 : -1;
  const item = index >= 0 ? pile[index] : null;
  const draft = item?.kind === "draft" ? item.draft : null;
  const mailing = item?.kind === "mailing" ? item.mailing : null;
  const [panel, setPanel] = useState<Panel>(null);
  const [armed, setArmed] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  // The back of the card (contact card, goal, latest emails), loaded the first time it is turned over.
  const [flipped, setFlipped] = useState(false);
  const [turning, setTurning] = useState(false);
  const [infos, setInfos] = useState<Record<string, CardInfo | { error: string }>>({});
  // The conversation on the front, loaded for the card on screen and the next one.
  const [threads, setThreads] = useState<Record<string, DraftThread | { error: string }>>({});
  const asked = useRef(new Set<string>());
  const cardRef = useRef<HTMLElement>(null);
  const toTop = () => cardRef.current?.scrollTo({ top: 0 });

  // Full screen: the page behind does not scroll.
  useEffect(() => {
    const root = document.documentElement.style;
    const previous = { overflow: root.overflow, overscrollBehaviorX: root.overscrollBehaviorX };
    root.overflow = "hidden";
    // A sideways swipe moves cards; it never goes back in the browser history.
    root.overscrollBehaviorX = "none";
    return () => {
      root.overflow = previous.overflow;
      root.overscrollBehaviorX = previous.overscrollBehaviorX;
    };
  }, []);

  useEffect(() => {
    if (index < 0) return;
    for (const next of [pile[index], pile[index + 1]]) {
      if (next?.kind !== "draft" || asked.current.has(next.id)) continue;
      asked.current.add(next.id);
      void loadDraftThread(next.id)
        .then((r) => setThreads((prev) => ({ ...prev, [next.id]: r.ok ? r.thread : { error: r.error } })))
        .catch(() => setThreads((prev) => ({ ...prev, [next.id]: { error: "Couldn't load the conversation." } })));
    }
  }, [pile, index]);

  // Notices ("Sent.", "Sent to the assistant.") fade by themselves; errors stay.
  useEffect(() => {
    if (message?.tone !== "ok") return;
    const t = setTimeout(() => setMessage(null), 2200);
    return () => clearTimeout(t);
  }, [message]);

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
      setFlipped(false);
      setPanel(null);
      setArmed(false);
      setMessage(null);
      toTop();
    },
    [pile, index],
  );

  /** The card leaves the pile; the next one (or the previous, at the end) takes its place. */
  const finish = (id: string, label: string) => {
    const at = pile.findIndex((d) => d.id === id);
    const next = pile[at + 1] ?? pile[at - 1] ?? null;
    setCurrentId(next?.id ?? null);
    setFlipped(false);
    setDone((prev) => ({ ...prev, [id]: label }));
    setPanel(null);
    setArmed(false);
    setMessage({ tone: "ok", text: label });
    toTop();
  };

  const run = <R extends { ok: boolean }>(action: () => Promise<R>, onOk: (r: R) => void) =>
    startTransition(async () => {
      const r = await action();
      if (r.ok) onOk(r);
      else setMessage({ tone: "error", text: ("error" in r && typeof r.error === "string" ? r.error : null) ?? "Something went wrong." });
    });

  /** Turn the card over: a quick half-turn, swap faces, half-turn back. */
  const flip = useCallback(() => {
    if (!item) return;
    const id = item.id;
    if (item.kind === "draft" && !flipped && !infos[id]) {
      void loadCardInfo(id).then((r) =>
        setInfos((prev) => ({
          ...prev,
          [id]: r.ok ? r.info : { error: r.error },
        })),
      );
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setFlipped((f) => !f);
      return;
    }
    setTurning(true);
    setTimeout(() => {
      setFlipped((f) => !f);
      setTurning(false);
      cardRef.current?.scrollTo({ top: 0 });
    }, 140);
  }, [item, flipped, infos]);

  // Swipe like a normal pager: the card follows the finger sideways, then
  // slides out and the next one slides in (or springs back on a short drag).
  // Vertical scrolling stays native; the direction is decided on the first move.
  const [shift, setShift] = useState<{ x: number; animate: boolean }>({ x: 0, animate: false });
  const gesture = useRef<{ x0: number; y0: number; axis: "x" | "y" | null; lastX: number; lastT: number; v: number } | null>(null);
  const sliding = useRef(false);
  /** When the last horizontal drag ended: the click that follows it does not flip the card. */
  const swipedAt = useRef(0);

  const slide = (delta: number) => {
    if (sliding.current) return;
    if (pile.length < 2 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShift({ x: 0, animate: true });
      if (pile.length > 1) go(delta);
      return;
    }
    sliding.current = true;
    const w = (cardRef.current?.offsetWidth ?? window.innerWidth) + 32;
    setShift({ x: delta > 0 ? -w : w, animate: true });
    setTimeout(() => {
      go(delta);
      // The next card starts off-screen on the other side, then slides in.
      setShift({ x: delta > 0 ? w : -w, animate: false });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setShift({ x: 0, animate: true });
          sliding.current = false;
        }),
      );
    }, SLIDE_MS);
  };
  // Listeners below always call the latest slide().
  const slideRef = useRef(slide);
  useEffect(() => {
    slideRef.current = slide;
  });

  const onTouchStart = (e: React.TouchEvent) => {
    if (panel || sliding.current || e.touches.length > 1) return;
    const t = e.touches[0];
    gesture.current = { x0: t.clientX, y0: t.clientY, axis: null, lastX: t.clientX, lastT: e.timeStamp, v: 0 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    const t = e.touches[0];
    const x = t.clientX - g.x0;
    const y = t.clientY - g.y0;
    if (!g.axis) {
      if (Math.hypot(x, y) < 8) return;
      g.axis = Math.abs(x) > Math.abs(y) ? "x" : "y";
    }
    if (g.axis !== "x") return;
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.v = (t.clientX - g.lastX) / dt;
    g.lastX = t.clientX;
    g.lastT = e.timeStamp;
    // Alone in the pile: it resists and comes back.
    setShift({ x: pile.length < 2 ? x / 3 : x, animate: false });
  };
  const onTouchEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.axis !== "x") return;
    swipedAt.current = Date.now();
    const x = shift.x;
    const width = cardRef.current?.offsetWidth ?? window.innerWidth;
    const flick = Math.abs(g.v) > 0.45 && Math.abs(x) > 24 && Math.sign(g.v) === Math.sign(x);
    if (Math.abs(x) > width * 0.28 || flick) slide(x < 0 ? 1 : -1);
    else setShift({ x: 0, animate: true });
  };

  // Trackpad: a sideways two-finger swipe moves one card (and never navigates the browser back).
  const wheel = useRef({ sum: 0, lockedUntil: 0 });
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const w = wheel.current;
      const now = Date.now();
      if (now < w.lockedUntil) {
        w.lockedUntil = now + 250; // the rest of the same gesture (momentum)
        return;
      }
      w.sum += e.deltaX;
      if (Math.abs(w.sum) > 60) {
        slideRef.current(w.sum > 0 ? 1 : -1);
        w.sum = 0;
        w.lockedUntil = now + 250;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [item?.id]);

  // Keyboard: ← → move, Escape closes a panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select") || e.target.isContentEditable);
      if (e.key === "Escape" && panel) setPanel(null);
      if (typing || panel) return;
      if (e.key === "ArrowRight") slideRef.current(1);
      if (e.key === "ArrowLeft") slideRef.current(-1);
      if (e.key === "i") flip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, flip]);

  if (!item) {
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
        <Link href="/" className="text-[15px] text-brand underline-offset-2 hover:underline md:text-sm">
          Back to Today
        </Link>
      </div>
    );
  }

  const assistantFlow = Boolean(draft?.assistantProjectId) && !draft?.campaignId;
  const busy = pending || draft?.status === "sending" || draft?.status === "revising";
  const reason = draft ? (draft.assistantReason ?? draft.rationale) : null;
  const org = draft?.organization;
  const tagline = org?.profile?.tagline;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-bg pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="relative mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-3 md:px-4 md:py-3">
        {/* Just a way out and where you are */}
        <div className="flex h-11 shrink-0 items-center gap-1">
          <Link
            href="/"
            aria-label="Close"
            title="Back to Today"
            className="-ml-1 flex size-10 items-center justify-center rounded-full text-muted active:bg-surface-2"
          >
            <X className="size-5" />
          </Link>
          <span className="text-[12px] tabular-nums text-subtle">
            {index + 1} / {pile.length}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => slide(-1)}
            aria-label="Previous email"
            className="hidden size-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 md:flex"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => slide(1)}
            aria-label="Next email"
            className="hidden size-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 md:flex"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        {message ? (
          <p
            role="status"
            className={cn(
              "pointer-events-none absolute inset-x-6 top-12 z-10 rounded-full px-4 py-2 text-center text-[13px] font-medium shadow-lg",
              message.tone === "ok" ? "bg-fg text-bg" : "bg-danger text-white",
            )}
          >
            {message.text}
          </p>
        ) : null}

        <article
          key={item.id}
          ref={cardRef}
          onClick={(e) => {
            // Tap anywhere on the card to turn it over (not on links or buttons, not after a swipe or while selecting text).
            if (Date.now() - swipedAt.current < 400) return;
            if ((e.target as HTMLElement).closest("a, button, input, textarea, select, label, [role=dialog]")) return;
            if (window.getSelection()?.toString()) return;
            flip();
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => {
            gesture.current = null;
            setShift({ x: 0, animate: true });
          }}
          style={{
            transform: `translateX(${shift.x}px) perspective(1200px) rotateY(${turning ? 90 : 0}deg)`,
            transition: shift.animate ? `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : shift.x ? "none" : "transform 150ms ease-in-out",
          }}
          className="min-h-0 min-w-0 flex-1 cursor-pointer touch-pan-y overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface shadow-sm [overflow-wrap:anywhere]"
        >
          {mailing ? <MailingFace mailing={mailing} flipped={flipped} /> : null}
          {draft ? (
            <>
              <header className="flex items-start gap-3 border-b border-border px-4 pb-3 pt-3.5">
                {draft.contact && !flipped ? <ContactAvatar contact={draft.contact} size="md" /> : null}
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
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        flip();
                      }}
                      aria-pressed={flipped}
                      title={flipped ? "Back to the email (i)" : "Contact card (i)"}
                      className="-my-1 -mr-1.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-fg/80 active:opacity-70"
                    >
                      {flipped ? <Mail className="size-3.5" aria-hidden /> : <Info className="size-3.5" aria-hidden />}
                      {flipped ? "Email" : "Info"}
                    </button>
                  </div>
                  {org && !flipped ? (
                    <p className="truncate text-[12px] text-muted">
                      <Link href={`/organizations/${org.id}`} className="font-medium text-fg/80 hover:underline">
                        {org.name}
                      </Link>
                      {tagline ? ` · ${tagline}` : ""}
                    </p>
                  ) : null}
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-subtle">
                    <AccountBadge email={draft.accountEmail} />
                    <span>{formatRelative(draft.updatedAt, timezone)}</span>
                  </p>
                </div>
              </header>

              {flipped ? (
                (() => {
                  const info = infos[draft.id];
                  if (!info) return <p className="px-4 py-6 text-center text-[13px] text-muted">Loading the contact card…</p>;
                  if ("error" in info) return <p className="px-4 py-6 text-center text-[13px] text-danger">{info.error}</p>;
                  return <CardBack draft={draft} info={info} timezone={timezone} />;
                })()
              ) : (
                <div className="flex flex-col gap-2 px-4 py-3">
                  {reason ? (
                    <p className="rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px] leading-snug text-muted">
                      <Sparkles className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                      {reason}
                    </p>
                  ) : null}
                  {draft.error ? <p className="rounded-md bg-warning/10 px-2.5 py-1.5 text-[12px] text-warning">{draft.error}</p> : null}
                  <DraftConversation draft={draft} thread={threads[draft.id]} timezone={timezone} />
                </div>
              )}
            </>
          ) : null}
        </article>

        {/* Actions under the card */}
        <div className="shrink-0 pb-2 pt-2">
          <div className="max-h-[70dvh] overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
            {mailing ? (
              <MailingActions
                mailing={mailing}
                pending={pending}
                onDiscard={() =>
                  run(
                    () => discardCampaignAction(mailing.id),
                    () => finish(item.id, "Mailing discarded."),
                  )
                }
                onApprove={(origin) =>
                  run(
                    () => startCampaignAction(mailing.id),
                    () => {
                      celebrateSend(origin);
                      finish(item.id, `Sending ${mailing.count} emails, a few at a time.`);
                    },
                  )
                }
              />
            ) : !draft ? null : panel === "edit" ? (
              <form
                className="flex flex-col gap-2 p-1"
                action={(formData) =>
                  run(
                    () => saveDraftEditsAction(draft.id, formData),
                    () => {
                      setPanel(null);
                      setMessage({ tone: "ok", text: "Saved." });
                    },
                  )
                }
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
                label={
                  panel === "changes"
                    ? `What should change? The assistant rewrites it in its next review (${ASSISTANT_REVIEW_TIMES}).`
                    : "Tell Claude what to change"
                }
                submit={panel === "changes" ? "Send to assistant" : "Rewrite"}
                pending={pending}
                onCancel={() => setPanel(null)}
                onSubmit={(text) =>
                  panel === "changes"
                    ? run(
                        () => requestAssistantChangesAction(draft.id, text),
                        () => finish(draft.id, "Sent to the assistant."),
                      )
                    : run(
                        () => reviseDraftAction(draft.id, text),
                        () => {
                          setPanel(null);
                          setMessage({ tone: "ok", text: "Rewritten." });
                        },
                      )
                }
              />
            ) : panel === "postpone" ? (
              <div className="p-1">
                <PostponeForm
                  today={today}
                  pending={pending}
                  onCancel={() => setPanel(null)}
                  onSubmit={(date) =>
                    run(
                      () => postponeAssistantDraftAction(draft.id, date),
                      () => finish(draft.id, "Postponed."),
                    )
                  }
                />
              </div>
            ) : (
              <div className="flex items-stretch gap-1">
                <IconAction
                  label="Discard"
                  tone="danger"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => discardDraftAction(draft.id),
                      () => finish(draft.id, "Discarded."),
                    )
                  }
                >
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
                    run(
                      () => approveDraftAction(id),
                      () => {
                        celebrateSend(origin);
                        finish(id, "Sent.");
                      },
                    );
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
                      <Check className="size-5 shrink-0" /> Approve
                      <span className="hidden md:inline"> & send</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Discard (two taps), open the mailing, approve and start sending (two taps). */
function MailingActions({
  mailing,
  pending,
  onDiscard,
  onApprove,
}: {
  mailing: MailingCardData;
  pending: boolean;
  onDiscard: () => void;
  onApprove: (origin: ReturnType<typeof flourishOrigin>) => void;
}) {
  const [armed, setArmed] = useState<null | "discard" | "approve">(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <div className="flex items-stretch gap-1">
      <IconAction
        label={armed === "discard" ? "Sure?" : "Discard"}
        tone="danger"
        disabled={pending}
        onClick={() => {
          if (armed !== "discard") return setArmed("discard");
          setArmed(null);
          onDiscard();
        }}
      >
        <Trash2 className="size-5" />
      </IconAction>
      <Link
        href={`/approvals/mailings/${mailing.id}`}
        title="Open the mailing: settings and every email"
        className="flex min-h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium text-muted active:bg-surface-2 md:w-16 md:hover:bg-surface-2"
      >
        <Pencil className="size-5" />
        Open
      </Link>
      <button
        type="button"
        disabled={pending || !mailing.accountOk || mailing.count === 0}
        onClick={(event) => {
          if (armed !== "approve") return setArmed("approve");
          setArmed(null);
          onApprove(flourishOrigin(event.currentTarget));
        }}
        className={cn(
          "flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 text-[15px] font-semibold text-white transition-colors active:opacity-80 disabled:opacity-60",
          armed === "approve" ? "bg-success" : "bg-brand",
        )}
      >
        {pending && armed === null ? (
          <>
            <VelaLoader size={16} label="Working" className="text-current" /> Working…
          </>
        ) : armed === "approve" ? (
          <span className="text-[14px]">Tap again to start</span>
        ) : (
          <>
            <Check className="size-5 shrink-0" /> Approve {mailing.count}
            <span className="hidden md:inline"> & start sending</span>
          </>
        )}
      </button>
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
