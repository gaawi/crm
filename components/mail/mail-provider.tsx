"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, X } from "lucide-react";
import { threadAction } from "@/app/(app)/mail/actions";
import type { ComposeKind } from "@/lib/mail/compose";
import type { ThreadAction } from "@/lib/mail/gmail";
import type { Address } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";

/**
 * Client state shared by every mail page (lives in app/(app)/mail/layout.tsx,
 * so it survives navigation between the list and threads): the composer,
 * optimistic thread changes, and the toast.
 */

export interface MailAccountOption {
  id: string;
  email: string;
  displayName: string | null;
  /** Tailwind class of the account's color dot. */
  dot: string;
}

export interface ComposeInit {
  kind?: ComposeKind;
  accountId?: string | null;
  threadId?: string | null;
  replyToGmailMessageId?: string | null;
  to?: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject?: string;
  body?: string;
  /** Quoted history (reply) or forwarded block, appended at send time. */
  appendix?: { kind: "quote" | "forward"; text: string } | null;
  /** Run "Write with Claude" right away with these instructions. */
  claude?: { instructions: string } | null;
}

export interface ComposeState extends Required<Omit<ComposeInit, "claude">> {
  id: number;
  claude: ComposeInit["claude"];
}

export interface ThreadTarget {
  key: string;
  accountId: string;
  threadId: string;
  /** lastAt of the row the change was made on (a newer message voids the override). */
  lastAt: number;
}

export interface ThreadOverride {
  lastAt: number;
  hidden?: boolean;
  unread?: boolean;
  starred?: boolean;
  done?: boolean;
}

interface Toast {
  id: number;
  message: string;
  tone?: "default" | "error";
  action?: { label: string; run: () => void };
  link?: { label: string; href: string };
}

interface ActOptions {
  /** The rows leave the current list (archive in Inbox, trash…). */
  hide?: boolean;
  /** Toast after success, with an Undo that runs these actions. */
  toast?: string;
  undo?: ThreadAction[];
}

interface MailContextValue {
  accounts: MailAccountOption[];
  timezone: string;
  ownAddresses: string[];
  compose: (init?: ComposeInit) => void;
  composeOpen: boolean;
  act: (targets: ThreadTarget[], action: ThreadAction, options?: ActOptions) => Promise<boolean>;
  overrides: Record<string, ThreadOverride>;
  /** Drop overrides that the server data now reflects. */
  settle: (rows: { key: string; lastAt: number; unread: boolean; starred: boolean }[]) => void;
  toast: (toast: Omit<Toast, "id">) => void;
}

const MailContext = createContext<MailContextValue | null>(null);

export function useMail(): MailContextValue {
  const value = useContext(MailContext);
  if (!value) throw new Error("useMail must be used inside <MailProvider>");
  return value;
}

function patchFor(action: ThreadAction, hide: boolean): Omit<ThreadOverride, "lastAt"> {
  switch (action) {
    case "read":
      return { unread: false };
    case "unread":
      return { unread: true };
    case "star":
      return { starred: true };
    case "unstar":
      return { starred: false };
    default:
      return { hidden: hide };
  }
}

let nextId = 1;

export function MailProvider({
  accounts,
  timezone,
  ownAddresses,
  children,
}: {
  accounts: MailAccountOption[];
  timezone: string;
  ownAddresses: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [composeState, setComposeState] = useState<ComposeState | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ThreadOverride>>({});
  const [toastState, setToast] = useState<Toast | null>(null);
  const dirtyRef = useRef(false);

  const toast = useCallback((t: Omit<Toast, "id">) => setToast({ ...t, id: nextId++ }), []);

  const compose = useCallback(
    (init: ComposeInit = {}) => {
      if (dirtyRef.current && !window.confirm("Discard the message you are writing?")) return;
      dirtyRef.current = false;
      const fallback = accounts[0]?.id ?? "";
      setComposeState({
        id: nextId++,
        kind: init.kind ?? "new",
        accountId: init.accountId && accounts.some((a) => a.id === init.accountId) ? init.accountId : fallback,
        threadId: init.threadId ?? null,
        replyToGmailMessageId: init.replyToGmailMessageId ?? null,
        to: init.to ?? [],
        cc: init.cc ?? [],
        bcc: init.bcc ?? [],
        subject: init.subject ?? "",
        body: init.body ?? "",
        appendix: init.appendix ?? null,
        claude: init.claude ?? null,
      });
    },
    [accounts],
  );

  const act = useCallback(
    async (targets: ThreadTarget[], action: ThreadAction, options: ActOptions = {}) => {
      if (!targets.length) return false;
      const patch = patchFor(action, Boolean(options.hide));
      const keys = new Set(targets.map((t) => t.key));
      setOverrides((prev) => {
        const next = { ...prev };
        for (const t of targets) {
          const same = prev[t.key]?.lastAt === t.lastAt ? prev[t.key] : { lastAt: t.lastAt };
          next[t.key] = { ...same, ...patch, lastAt: t.lastAt, done: false };
        }
        return next;
      });
      const revert = () =>
        setOverrides((prev) => {
          const next = { ...prev };
          for (const key of keys) delete next[key];
          return next;
        });

      let result: Awaited<ReturnType<typeof threadAction>>;
      try {
        result = await threadAction(
          targets.map((t) => ({ accountId: t.accountId, threadId: t.threadId })),
          action,
          { refresh: false },
        );
      } catch {
        result = { ok: false, error: "Could not reach the server. Check your connection." };
      }
      if (!result.ok || result.done < targets.length) {
        revert();
        startTransition(() => router.refresh());
        toast({
          tone: "error",
          message: result.ok ? `${targets.length - result.done} of ${targets.length} conversations could not be changed.` : result.error,
        });
        return false;
      }
      setOverrides((prev) => {
        const next = { ...prev };
        for (const key of keys) if (next[key]) next[key] = { ...next[key], done: true };
        return next;
      });
      startTransition(() => router.refresh());
      if (options.toast) {
        const undo = options.undo;
        toast({
          message: options.toast,
          action: undo?.length
            ? {
                label: "Undo",
                run: async () => {
                  for (const [i, a] of undo.entries()) {
                    const ok = await act(targets, a, { toast: i === undo.length - 1 ? "Action undone." : undefined });
                    if (!ok) break;
                  }
                },
              }
            : undefined,
        });
      }
      return true;
    },
    [router, toast],
  );

  const settle = useCallback((rows: { key: string; lastAt: number; unread: boolean; starred: boolean }[]) => {
    setOverrides((prev) => {
      const byKey = new Map(rows.map((r) => [r.key, r]));
      let changed = false;
      const next = { ...prev };
      for (const [key, o] of Object.entries(prev)) {
        if (!o.done) continue;
        const row = byKey.get(key);
        const settled = o.hidden
          ? !row || row.lastAt !== o.lastAt
          : !row || row.lastAt !== o.lastAt || ((o.unread === undefined || row.unread === o.unread) && (o.starred === undefined || row.starred === o.starred));
        if (settled) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const value = useMemo<MailContextValue>(
    () => ({ accounts, timezone, ownAddresses, compose, composeOpen: composeState !== null, act, overrides, settle, toast }),
    [accounts, timezone, ownAddresses, compose, composeState, act, overrides, settle, toast],
  );

  return (
    <MailContext.Provider value={value}>
      {children}
      {composeState ? (
        <Composer
          key={composeState.id}
          initial={composeState}
          onDirtyChange={(dirty) => {
            dirtyRef.current = dirty;
          }}
          onClose={() => {
            dirtyRef.current = false;
            setComposeState(null);
          }}
        />
      ) : null}
      <ToastView toast={toastState} onDismiss={() => setToast(null)} />
    </MailContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, toast.tone === "error" ? 9000 : 6000);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-[70] flex justify-center md:inset-x-auto md:bottom-6 md:left-6 md:justify-start"
    >
      {toast ? (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-[15px] shadow-xl md:rounded-lg md:py-2.5 md:text-sm",
            toast.tone === "error"
              ? "bg-red-600 text-white dark:bg-red-700"
              : "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900",
          )}
        >
          {toast.tone === "error" ? <CircleAlert className="size-4 shrink-0" strokeWidth={2} /> : null}
          <span className="min-w-0 flex-1">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                onDismiss();
                toast.action?.run();
              }}
              className="shrink-0 font-semibold text-blue-300 active:opacity-60 dark:text-blue-700 md:hover:underline"
            >
              {toast.action.label}
            </button>
          ) : null}
          {toast.link ? (
            <Link href={toast.link.href} onClick={onDismiss} className="shrink-0 font-semibold text-blue-300 active:opacity-60 dark:text-blue-700 md:hover:underline">
              {toast.link.label}
            </Link>
          ) : null}
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-mr-1 shrink-0 rounded p-1 opacity-70 hover:opacity-100">
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
