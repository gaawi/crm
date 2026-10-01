"use client";

import { useRouter } from "next/navigation";
import { useClaudeEnabled } from "@/components/features";
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Maximize2, Minimize2, Minus, Send, Sparkles, Trash2, X } from "lucide-react";
import { sendMailAction, writeWithClaudeAction } from "@/app/(app)/mail/actions";
import { formatAddress, outgoingBody, parseRecipientInput } from "@/lib/mail/compose";
import { threadHref } from "@/lib/mail/params";
import type { Address } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMail, type ComposeState } from "./mail-provider";
import { RecipientInput } from "./recipient-input";

type WindowMode = "normal" | "minimized" | "expanded";

const TITLES: Record<ComposeState["kind"], string> = {
  new: "New Message",
  reply: "Reply",
  reply_all: "Reply All",
  forward: "Forward",
};

/** Keeps the phone sheet inside the visual viewport so the keyboard never covers it. */
function useVisualViewport() {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBox({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return box;
}

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

/**
 * Gmail's compose panel on desktop (bottom right; minimize, expand, close)
 * and an iOS Mail sheet on phones (Cancel / title / Send). Nothing is sent
 * until the owner presses Send.
 */
export function Composer({
  initial,
  onClose,
  onDirtyChange,
}: {
  initial: ComposeState;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const claude = useClaudeEnabled();
  const router = useRouter();
  const { accounts, toast } = useMail();
  const phone = useIsPhone();
  const viewport = useVisualViewport();

  const [mode, setMode] = useState<WindowMode>("normal");
  const [accountId, setAccountId] = useState(initial.accountId);
  const [to, setTo] = useState<Address[]>(initial.to);
  const [cc, setCc] = useState<Address[]>(initial.cc);
  const [bcc, setBcc] = useState<Address[]>(initial.bcc);
  const [pending, setPending] = useState({ to: "", cc: "", bcc: "" });
  const [showCc, setShowCc] = useState(initial.cc.length > 0);
  const [showBcc, setShowBcc] = useState(initial.bcc.length > 0);
  const [phoneExtra, setPhoneExtra] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [includeAppendix, setIncludeAppendix] = useState(true);
  const [showAppendix, setShowAppendix] = useState(false);
  const [claudeOpen, setClaudeOpen] = useState(Boolean(initial.claude));
  const [prompt, setPrompt] = useState(initial.claude?.instructions ?? "");
  const [writing, setWriting] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const isReply = initial.kind === "reply" || initial.kind === "reply_all";
  const account = accounts.find((a) => a.id === accountId);

  const dirty = body.trim() !== "" || (initial.kind === "new" && (to.length > 0 || subject.trim() !== ""));
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // Autosize the body.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, phone ? 200 : 160)}px`;
  }, [body, mode, phone]);

  // Phones: the page behind the sheet must not scroll.
  useEffect(() => {
    if (!phone) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [phone]);

  // Replies start in the body; new messages in To.
  useEffect(() => {
    if (initial.kind !== "new" && initial.kind !== "forward" && !initial.claude) bodyRef.current?.focus({ preventScroll: true });
  }, [initial.kind, initial.claude]);

  const runClaude = useCallback(
    async (instructions: string) => {
      setWriting(true);
      setClaudeError(null);
      try {
        const result = await writeWithClaudeAction({
          kind: initial.kind,
          accountId: accountId || null,
          threadId: initial.threadId,
          to: [...to, ...cc].map((a) => a.email),
          subject,
          body,
          instructions,
        });
        if (!result.ok) setClaudeError(result.error);
        else {
          setBody(result.body);
          if (initial.kind === "new" || !subject.trim()) setSubject(result.subject);
          setClaudeOpen(false);
        }
      } catch {
        setClaudeError("Could not reach Claude. Try again.");
      } finally {
        setWriting(false);
      }
    },
    [initial.kind, initial.threadId, accountId, to, cc, subject, body],
  );

  // "Draft reply with Claude" opens the composer and writes right away.
  const autoRan = useRef(false);
  useEffect(() => {
    if (initial.claude && !autoRan.current) {
      autoRan.current = true;
      void runClaude(initial.claude.instructions);
    }
  }, [initial.claude, runClaude]);

  function takePending(field: "to" | "cc" | "bcc", list: Address[]): { list: Address[]; invalid: string } {
    const { addresses, rest } = parseRecipientInput(pending[field]);
    const seen = new Set(list.map((a) => a.email));
    return { list: [...list, ...addresses.filter((a) => !seen.has(a.email))], invalid: rest };
  }

  async function send() {
    if (sending) return;
    setError(null);
    const t = takePending("to", to);
    const c = takePending("cc", cc);
    const b = takePending("bcc", bcc);
    setTo(t.list);
    setCc(c.list);
    setBcc(b.list);
    setPending({ to: t.invalid, cc: c.invalid, bcc: b.invalid });
    const invalid = t.invalid || c.invalid || b.invalid;
    if (invalid) {
      setError(`Check this address: ${invalid}`);
      return;
    }
    if (!t.list.length && !c.list.length && !b.list.length) {
      setError("Add at least one recipient.");
      return;
    }
    if (!accountId) {
      setError("Connect a Gmail account in Settings to send email.");
      return;
    }
    if (!subject.trim() && !window.confirm("Send this message without a subject?")) return;
    setSending(true);
    try {
      const result = await sendMailAction({
        accountId,
        to: t.list.map(formatAddress),
        cc: c.list.map(formatAddress),
        bcc: b.list.map(formatAddress),
        subject,
        body: outgoingBody(body, initial.appendix?.text ?? null, includeAppendix),
        replyToGmailMessageId: isReply ? initial.replyToGmailMessageId : null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
      toast({ message: "Sent", link: { label: "View message", href: threadHref(accountId, result.threadId, {}) } });
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server. Your message was not sent.");
    } finally {
      setSending(false);
    }
  }

  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape" && !phone) {
      if (confirmDiscard) setConfirmDiscard(false);
      else if (mode === "expanded") setMode("normal");
      else setMode("minimized");
    }
  }

  const title = subject.trim() && initial.kind === "new" ? subject.trim() : TITLES[initial.kind];
  const minimized = mode === "minimized" && !phone;
  const expanded = mode === "expanded" && !phone;
  const phoneStyle = phone && viewport ? { top: viewport.top, height: viewport.height } : undefined;

  return (
    <>
      {expanded ? <div className="fixed inset-0 z-[55] hidden bg-black/30 md:block" onClick={() => setMode("normal")} aria-hidden /> : null}
      <div
        ref={rootRef}
        role="dialog"
        aria-label={TITLES[initial.kind]}
        aria-modal={phone || expanded ? true : undefined}
        onKeyDown={onKeyDown}
        style={phoneStyle}
        className={cn(
          "fixed z-[60] flex flex-col overflow-hidden bg-surface text-fg",
          // Phone: full-screen sheet.
          "max-md:inset-x-0 max-md:top-0 max-md:h-dvh",
          // Desktop: Gmail panel.
          "md:border md:border-border md:shadow-2xl",
          minimized
            ? "md:bottom-0 md:right-6 md:w-72 md:rounded-t-lg"
            : expanded
              ? "md:left-1/2 md:top-1/2 md:h-[88vh] md:w-[min(64rem,92vw)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl"
              : "md:bottom-0 md:right-6 md:h-[min(38rem,calc(100dvh-5rem))] md:w-[34rem] md:rounded-t-xl",
        )}
      >
        {/* Phone header: Cancel / title / Send */}
        <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:hidden">
          <button type="button" onClick={requestClose} className="flex h-11 items-center justify-self-start text-[17px] text-fg/80 active:opacity-60">
            Cancel
          </button>
          <h2 className="max-w-[12rem] truncate text-[17px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className="flex h-11 items-center gap-1.5 justify-self-end text-[17px] font-semibold text-blue-600 active:opacity-60 disabled:opacity-50 dark:text-blue-400"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : null}
            {sending ? "Sending" : "Send"}
          </button>
        </header>

        {/* Desktop header */}
        <header
          className={cn(
            "hidden h-10 shrink-0 cursor-default items-center gap-1 bg-surface-2 pl-4 pr-2 md:flex",
            minimized && "cursor-pointer",
          )}
          onClick={() => minimized && setMode("normal")}
        >
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
          <HeaderButton label={minimized ? "Restore" : "Minimize"} onClick={(e) => { e.stopPropagation(); setMode(minimized ? "normal" : "minimized"); }}>
            <Minus className="size-4" />
          </HeaderButton>
          <HeaderButton label={expanded ? "Exit full screen" : "Full screen"} onClick={(e) => { e.stopPropagation(); setMode(expanded ? "normal" : "expanded"); }}>
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </HeaderButton>
          <HeaderButton label="Close" onClick={(e) => { e.stopPropagation(); requestClose(); }}>
            <X className="size-4" />
          </HeaderButton>
        </header>

        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", minimized && "md:hidden")}>
          <RecipientInput
            label="To:"
            value={to}
            onChange={setTo}
            pending={pending.to}
            onPendingChange={(text) => setPending((p) => ({ ...p, to: text }))}
            autoFocus={initial.kind === "new" || initial.kind === "forward"}
            trailing={
              <div className="mt-1 hidden shrink-0 items-center gap-2 text-sm text-muted md:flex">
                {!showCc ? (
                  <button type="button" onClick={() => setShowCc(true)} className="h-7 hover:text-fg hover:underline">
                    Cc
                  </button>
                ) : null}
                {!showBcc ? (
                  <button type="button" onClick={() => setShowBcc(true)} className="h-7 hover:text-fg hover:underline">
                    Bcc
                  </button>
                ) : null}
              </div>
            }
          />

          {/* Phone: iOS Mail's collapsed "Cc/Bcc, From:" row */}
          {!phoneExtra ? (
            <button
              type="button"
              onClick={() => {
                setPhoneExtra(true);
                setShowCc(true);
                setShowBcc(true);
              }}
              className="flex min-h-12 w-full items-center gap-2 border-b border-border px-4 text-left text-[15px] text-subtle md:hidden"
            >
              Cc/Bcc, From:
              <span className="min-w-0 truncate text-fg">{account?.email}</span>
            </button>
          ) : null}

          <div className={cn(!phoneExtra && "max-md:hidden", !showCc && "md:hidden")}>
            <RecipientInput label="Cc:" value={cc} onChange={setCc} pending={pending.cc} onPendingChange={(text) => setPending((p) => ({ ...p, cc: text }))} />
          </div>
          <div className={cn(!phoneExtra && "max-md:hidden", !showBcc && "md:hidden")}>
            <RecipientInput label="Bcc:" value={bcc} onChange={setBcc} pending={pending.bcc} onPendingChange={(text) => setPending((p) => ({ ...p, bcc: text }))} />
          </div>

          <div className={cn("flex min-h-12 items-center gap-2 border-b border-border px-4 md:min-h-10 md:px-3", !phoneExtra && "max-md:hidden")}>
            <label htmlFor="compose-from" className="shrink-0 text-[15px] text-subtle md:text-sm">
              From:
            </label>
            <div className="relative min-w-0 flex-1">
              <select
                id="compose-from"
                data-bare
                value={accountId ?? ""}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={isReply || accounts.length < 2}
                title={isReply ? "Replies are sent from the account that received the conversation" : undefined}
                className="h-10 w-full appearance-none truncate bg-transparent pr-6 text-base text-fg outline-none disabled:opacity-100 md:h-8 md:text-sm"
              >
                {accounts.length ? null : <option value="">No Gmail account connected</option>}
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName ? `${a.displayName} <${a.email}>` : a.email}
                  </option>
                ))}
              </select>
              {!isReply && accounts.length > 1 ? (
                <ChevronDown className="pointer-events-none absolute right-0 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              ) : null}
            </div>
          </div>

          <div className="flex min-h-12 items-center gap-2 border-b border-border px-4 md:min-h-10 md:px-3">
            <label htmlFor="compose-subject" className="shrink-0 text-[15px] text-subtle md:sr-only">
              Subject:
            </label>
            <input
              id="compose-subject"
              data-bare
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              maxLength={998}
              className="h-10 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-subtle max-md:placeholder:text-transparent md:h-8 md:text-sm"
            />
          </div>

          <textarea
            ref={bodyRef}
            data-bare
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Message"
            placeholder={initial.kind === "forward" ? "Add a note (optional)" : ""}
            className="block w-full resize-none bg-transparent px-4 py-3 text-base leading-relaxed text-fg outline-none placeholder:text-subtle md:px-3 md:text-sm"
          />

          {initial.appendix ? (
            <div className="mx-4 mb-3 md:mx-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {initial.appendix.kind === "quote" ? (
                  <label className="flex min-h-11 items-center gap-2 text-[15px] text-muted md:min-h-0 md:text-xs">
                    <input
                      type="checkbox"
                      checked={includeAppendix}
                      onChange={(e) => setIncludeAppendix(e.target.checked)}
                      className="size-5 accent-current md:size-3.5"
                    />
                    Include quoted text
                  </label>
                ) : (
                  <span className="text-[13px] text-muted md:text-xs">Forwarded message below. Attachments are not forwarded.</span>
                )}
                <button
                  type="button"
                  onClick={() => setShowAppendix((v) => !v)}
                  aria-expanded={showAppendix}
                  className="inline-flex h-9 items-center rounded-full bg-surface-2 px-3 text-xs font-semibold tracking-widest text-muted hover:text-fg md:h-6 md:px-2"
                  title={showAppendix ? "Hide" : "Show"}
                >
                  •••
                </button>
              </div>
              {showAppendix ? (
                <pre
                  className={cn(
                    "prose-plain mt-2 max-h-72 overflow-y-auto rounded-md border-l-2 border-border-strong pl-3 font-sans text-[13px] leading-relaxed text-muted md:text-xs",
                    !includeAppendix && "opacity-50",
                  )}
                >
                  {initial.appendix.text}
                </pre>
              ) : null}
            </div>
          ) : null}

          {claude && (claudeOpen || writing || claudeError) ? (
            <div className="mx-4 mb-3 rounded-xl border border-border bg-bg p-3 md:mx-3 md:rounded-lg md:p-2.5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runClaude(prompt);
                }}
                className="flex flex-col gap-2 md:flex-row md:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Sparkles className="size-4 shrink-0 text-orange-500" strokeWidth={2} />
                  <input
                    value={prompt}
                    data-bare
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={initial.kind === "new" ? "What should Claude write?" : "Instructions for Claude (optional)"}
                    maxLength={2000}
                    disabled={writing}
                    className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle md:h-7 md:text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={writing || (initial.kind === "new" && !prompt.trim() && !body.trim())}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-[15px] font-medium text-accent-fg disabled:opacity-50 md:h-7 md:rounded-md md:px-3 md:text-xs"
                >
                  {writing ? <Loader2 className="size-4 animate-spin md:size-3.5" /> : null}
                  {writing ? "Writing…" : body.trim() ? "Rewrite" : "Write"}
                </button>
              </form>
              {claudeError ? (
                <p role="alert" className="mt-2 text-[13px] text-danger md:text-xs">
                  {claudeError}
                </p>
              ) : writing ? (
                <p className="mt-2 text-[13px] text-muted md:text-xs">Claude is writing in your voice. Nothing is sent until you press Send.</p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mx-4 mb-3 rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-800 dark:bg-red-950 dark:text-red-200 md:mx-3 md:text-sm">
              {error}
            </p>
          ) : null}

          {/* Phone: Claude entry in the sheet body */}
          {claude && !claudeOpen && !writing ? (
            <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:hidden">
              <button
                type="button"
                onClick={() => setClaudeOpen(true)}
                className="flex h-11 items-center gap-2 rounded-full border border-border px-4 text-[15px] text-fg active:bg-surface-2"
              >
                <Sparkles className="size-4 text-orange-500" strokeWidth={2} />
                Write with Claude
              </button>
            </div>
          ) : null}
        </div>

        {/* Desktop footer */}
        <footer className={cn("hidden shrink-0 items-center gap-2 border-t border-border px-3 py-2 md:flex", minimized && "md:hidden")}>
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            title="Send (⌘/Ctrl+Enter)"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" strokeWidth={2} />}
            {sending ? "Sending…" : "Send"}
          </button>
          {claude ? (
            <button
              type="button"
              onClick={() => setClaudeOpen((v) => !v)}
              aria-pressed={claudeOpen}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg"
            >
              <Sparkles className="size-4 text-orange-500" strokeWidth={2} />
              Write with Claude
            </button>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            onClick={requestClose}
            aria-label="Discard"
            title="Discard"
            className="inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
          >
            <Trash2 className="size-4" strokeWidth={1.75} />
          </button>
        </footer>

        {confirmDiscard ? (
          <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/30 p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] md:justify-end md:bg-black/10 md:p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3 md:rounded-lg md:border md:border-border md:bg-surface md:px-3 md:py-2 md:shadow-lg">
              <p className="hidden flex-1 text-sm md:block">Discard this message?</p>
              <div className="overflow-hidden rounded-2xl bg-surface md:contents">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-14 w-full items-center justify-center text-[17px] text-danger active:bg-surface-2 md:h-8 md:w-auto md:rounded-md md:bg-danger md:px-3 md:text-sm md:font-medium md:text-white md:hover:opacity-90"
                >
                  <span className="md:hidden">Delete Draft</span>
                  <span className="hidden md:inline">Discard</span>
                </button>
              </div>
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmDiscard(false)}
                className="flex h-14 w-full items-center justify-center rounded-2xl bg-surface text-[17px] font-semibold active:bg-surface-2 md:h-8 md:w-auto md:rounded-md md:px-3 md:text-sm md:font-normal md:text-muted md:hover:bg-surface-2"
              >
                <span className="md:hidden">Cancel</span>
                <span className="hidden md:inline">Keep editing</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function HeaderButton({ label, onClick, children }: { label: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-border hover:text-fg"
    >
      {children}
    </button>
  );
}
