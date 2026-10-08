"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { archiveAllAction, archiveAllPreviewAction, type ArchiveAllPreview } from "@/app/(app)/mail/actions";
import { buttonClass } from "@/components/ui/button";
import { TAB_TITLES, type InboxTab } from "@/lib/mail/params";
import { cn } from "@/lib/utils";
import { archiveQuestion, archiveScopeLabel, archivedMessage, conversations, formatCount } from "./archive-all-copy";
import { useMail } from "./mail-provider";

/**
 * "Archive all" in the Inbox: nothing to select. The desktop toolbar button
 * and the phone list-header menu both open the same confirmation, which
 * counts the conversations of the scope (this tab or the whole inbox; one
 * account or all), says which accounts would be left out, and only then
 * archives in Gmail. The list refreshes with the action; a toast reports it.
 */

export interface ArchiveAllScope {
  /** One account, or null = every account. */
  accountId: string | null;
  /** The Inbox tab on screen. */
  tab: InboxTab;
  /** "all accounts", or the account's address. */
  accountLabel: string;
}

/** This tab only, or every inbox tab. */
type Choice = "tab" | "inbox";

const OFFLINE = "Could not reach the server. Check your connection.";

export interface ArchiveAllControl {
  /** Open the confirmation (or, while archiving, the progress). */
  start: () => void;
  running: boolean;
  /** Render this once, anywhere: the dialog (portaled to <body>). */
  dialog: ReactNode;
}

export function useArchiveAll(scope: ArchiveAllScope | null): ArchiveAllControl {
  const { toast } = useMail();
  const [open, setOpen] = useState(false);
  // The scope the dialog was opened for: the page can move on while it archives.
  const [target, setTarget] = useState<ArchiveAllScope | null>(null);
  const [preview, setPreview] = useState<ArchiveAllPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>("tab");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openRef = useRef(false);
  const requestRef = useRef(0);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /** Count the scope; `keep` leaves the current numbers on screen until the new ones arrive. */
  async function load(s: ArchiveAllScope, keep = false) {
    const request = ++requestRef.current;
    if (!keep) setPreview(null);
    setLoadError(null);
    let result: Awaited<ReturnType<typeof archiveAllPreviewAction>>;
    try {
      result = await archiveAllPreviewAction({ accountId: s.accountId, category: s.tab });
    } catch {
      result = { ok: false, error: OFFLINE };
    }
    if (request !== requestRef.current) return;
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setPreview(result);
    // Nothing left in this tab but mail in the others: offer the whole inbox.
    if (result.count === 0 && result.total > 0) setChoice("inbox");
  }

  function start() {
    if (running) {
      setOpen(true);
      return;
    }
    if (!scope) return;
    setTarget(scope);
    setChoice("tab");
    setError(null);
    setOpen(true);
    void load(scope);
  }

  async function confirm() {
    if (running || !target || !preview) return;
    setRunning(true);
    setError(null);
    let result: Awaited<ReturnType<typeof archiveAllAction>>;
    try {
      result = await archiveAllAction({ accountId: target.accountId, category: choice === "tab" ? target.tab : null });
    } catch {
      result = { ok: false, error: OFFLINE };
    }
    setRunning(false);
    if (!result.ok) {
      if (openRef.current) {
        setError(result.error);
        // A failure can change what is possible (an account now needs reconnecting): recount.
        void load(target, true);
      } else {
        toast({
          tone: "error",
          message: `Archive all failed: ${result.error}`,
          link: /reconnect/i.test(result.error) ? { label: "Settings", href: "/settings" } : undefined,
        });
      }
      return;
    }
    setOpen(false);
    toast({
      message: archivedMessage(result),
      link: result.warnings.length ? { label: "Settings", href: "/settings" } : undefined,
    });
  }

  const dialog =
    open && target ? (
      <ArchiveAllDialog
        scope={target}
        preview={preview}
        loadError={loadError}
        choice={choice}
        onChoice={setChoice}
        running={running}
        error={error}
        onConfirm={() => void confirm()}
        onRetry={() => void load(target)}
        onClose={() => setOpen(false)}
      />
    ) : null;

  return { start, running, dialog };
}

const visible = (el: HTMLElement) => el.getClientRects().length > 0;
// Tab stops: a radio group is one stop (its checked radio).
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="radio"]),input[type="radio"]:checked:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The confirmation: an iOS action sheet on phones (message card, action,
 * separate Cancel), a centered alert dialog on desktop. Focus starts on
 * Cancel, Tab stays inside, Escape and the backdrop close it; closing while
 * archiving only hides it (the work goes on and a toast reports the result).
 */
function ArchiveAllDialog({
  scope,
  preview,
  loadError,
  choice,
  onChoice,
  running,
  error,
  onConfirm,
  onRetry,
  onClose,
}: {
  scope: ArchiveAllScope;
  preview: ArchiveAllPreview | null;
  loadError: string | null;
  choice: Choice;
  onChoice: (choice: Choice) => void;
  running: boolean;
  error: string | null;
  onConfirm: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const panel = panelRef.current;
    const initial = panel ? [...panel.querySelectorAll<HTMLElement>("[data-autofocus]")].find(visible) : undefined;
    (initial ?? panel)?.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      if (!panel) return;
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const offerInbox = Boolean(preview && preview.ready > 0 && preview.total > preview.count);
  const effective: Choice = offerInbox ? choice : "tab";
  const count = preview ? (effective === "tab" ? preview.count : preview.total) : null;
  const scopeText = archiveScopeLabel(effective === "tab" ? scope.tab : null, scope.accountLabel);
  const blockedAll = Boolean(preview && preview.ready === 0);
  const empty = Boolean(preview && preview.ready > 0 && count === 0);
  const canConfirm = Boolean(preview && !blockedAll && !empty && !running);

  const question = running
    ? `Archiving ${count === null ? "the conversations" : conversations(count)} in ${scopeText}…`
    : blockedAll
      ? "Gmail needs to be reconnected before Archive all can change your inbox."
      : empty
        ? `Nothing to archive: ${scopeText} is empty.`
        : archiveQuestion(count, scopeText);
  const actionLabel = running ? "Archiving…" : error ? "Try again" : count ? `Archive ${conversations(count)}` : "Archive all";
  const cancelLabel = running ? "Close" : "Cancel";

  const notes: ReactNode[] = [];
  if (running) notes.push(<p key="running">Large inboxes can take a minute. You can close this: a message appears when it is done.</p>);
  if (!preview && !loadError) {
    notes.push(
      <p key="loading" className="flex items-center justify-center gap-2 md:justify-start">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Counting conversations…
      </p>,
    );
  }
  if (preview && !running) {
    if (blockedAll) {
      for (const reason of preview.blocked) notes.push(<p key={reason}>{reason}.</p>);
    } else if (preview.blocked.length) {
      notes.push(
        <p key="blocked" className="text-warning">
          Left out: {preview.blocked.join("; ")}.
        </p>,
      );
    }
    if (!blockedAll && !empty) notes.push(
        <p key="sync" className="hidden md:block">
          Counted from the last sync; anything newer in this inbox is archived too.
        </p>,
      );
  }
  if (loadError) {
    notes.push(
      <p key="load-error" role="alert" className="text-danger">
        Couldn’t count the conversations: {loadError}{" "}
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
          Try again
        </button>
      </p>,
    );
  }
  if (error) {
    notes.push(
      <p key="error" role="alert" className="flex items-start justify-center gap-1.5 text-left text-danger md:justify-start">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Couldn’t archive: {error}</span>
      </p>,
    );
  }

  const options: { value: Choice; label: string; count: number }[] =
    preview && offerInbox
      ? [
          { value: "tab", label: `${TAB_TITLES[scope.tab]} only`, count: preview.count },
          { value: "inbox", label: "Every inbox tab", count: preview.total },
        ]
      : [];

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/40 md:bg-fg/20" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
        aria-busy={running || (!preview && !loadError)}
        className={cn(
          "absolute inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] flex flex-col gap-2 text-fg outline-none max-md:animate-sheet-up",
          "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-[max(2rem,14vh)] md:w-[min(28rem,calc(100vw-2rem))] md:-translate-x-1/2",
        )}
      >
        <div className="overflow-hidden rounded-[14px] bg-surface md:rounded-xl md:border md:border-border md:shadow-2xl">
          <div className="px-4 pb-3 pt-4 text-center md:px-5 md:pb-0 md:pt-4 md:text-left">
            <h2 id={`${id}-title`} className="text-[13px] font-semibold text-muted md:text-base md:text-fg">
              Archive all
            </h2>
            <p id={`${id}-text`} className="mt-1 text-[13px] leading-snug text-muted md:mt-1.5 md:text-sm md:text-fg">
              {question}
            </p>
          </div>

          {options.length ? (
            <fieldset disabled={running} className="md:mx-5 md:mt-3 md:overflow-hidden md:rounded-lg md:border md:border-border">
              <legend className="sr-only">What to archive</legend>
              {options.map((o) => (
                <label
                  key={o.value}
                  className={cn(
                    "flex min-h-[48px] cursor-pointer items-center gap-3 border-t border-border px-4 text-left active:bg-surface-2 has-[:focus-visible]:bg-surface-2",
                    "md:min-h-10 md:gap-2.5 md:px-3 md:first:border-t-0 md:hover:bg-surface-2",
                    effective === o.value && "md:bg-surface-2",
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-scope`}
                    value={o.value}
                    checked={effective === o.value}
                    onChange={() => onChoice(o.value)}
                    className="size-4 shrink-0 accent-blue-600 max-md:sr-only"
                  />
                  <span className="min-w-0 flex-1 truncate text-[17px] md:text-sm">{o.label}</span>
                  <span className="shrink-0 text-[15px] tabular-nums text-muted md:text-sm">{formatCount(o.count)}</span>
                  <Check
                    aria-hidden
                    strokeWidth={2.5}
                    className={cn("size-5 shrink-0 text-blue-600 md:hidden dark:text-blue-400", effective !== o.value && "invisible")}
                  />
                </label>
              ))}
            </fieldset>
          ) : null}

          {notes.length ? (
            <div className={cn("flex flex-col gap-1.5 px-4 pb-3 text-center text-[13px] leading-snug text-muted md:px-5 md:pb-0 md:pt-3 md:text-left md:text-xs", options.length > 0 && "pt-3")}>
              {notes}
            </div>
          ) : null}

          {/* Phone: the action row of the sheet. */}
          <div className="border-t border-border md:hidden">
            {blockedAll ? (
              <Link href="/settings" className="flex h-14 w-full items-center justify-center text-[20px] text-blue-600 active:bg-surface-2 dark:text-blue-400">
                Open Settings
              </Link>
            ) : (
              <button
                type="button"
                onClick={onConfirm}
                disabled={!canConfirm}
                className="flex h-14 w-full items-center justify-center gap-2 text-[20px] text-blue-600 active:bg-surface-2 disabled:text-subtle dark:text-blue-400"
              >
                {running ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
                {actionLabel}
              </button>
            )}
          </div>

          {/* Desktop footer. */}
          <div className="hidden items-center justify-end gap-2 px-5 pb-4 pt-4 md:flex">
            <button type="button" data-autofocus onClick={onClose} className={buttonClass("ghost")}>
              {cancelLabel}
            </button>
            {blockedAll ? (
              <Link href="/settings" className={buttonClass("primary")}>
                Open Settings
              </Link>
            ) : (
              <button type="button" onClick={onConfirm} disabled={!canConfirm} className={buttonClass("primary")}>
                {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {actionLabel}
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          data-autofocus
          onClick={onClose}
          className="h-14 rounded-[14px] bg-surface text-[20px] font-semibold text-blue-600 active:bg-surface-2 md:hidden dark:text-blue-400"
        >
          {cancelLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
