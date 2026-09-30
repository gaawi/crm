"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAILBOX_ICONS, type MailboxEntry, type MailboxGroups } from "./mailboxes";

const OPERATOR_HINT = "Search mail — from: to: subject: has:attachment is:unread label: after:";

/** Desktop search bar (Gmail operators are parsed server-side; "/" focuses it). */
export function DesktopSearch({ q, account, clearHref }: { q: string; account: string | null; clearHref: string }) {
  return (
    <form action="/mail" role="search" className="relative w-full max-w-3xl">
      <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" strokeWidth={1.75} />
      <input
        id="mail-search"
        name="q"
        type="search"
        defaultValue={q}
        key={q}
        placeholder={OPERATOR_HINT}
        aria-label="Search mail"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        className="h-11 w-full rounded-full border border-transparent bg-surface-2 pl-11 pr-10 text-sm text-fg placeholder:text-subtle focus:border-border focus:bg-surface focus:shadow-md focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {account ? <input type="hidden" name="account" value={account} /> : null}
      {q ? (
        <Link href={clearHref} aria-label="Clear search" className="absolute right-3 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-border hover:text-fg">
          <X className="size-4" />
        </Link>
      ) : null}
    </form>
  );
}

/**
 * iPhone Mail's list header: "‹ Mailboxes" bar (the title shrinks into it on
 * scroll), a large title, the search field, and the Mailboxes sheet.
 */
export function PhoneMailHeader({
  title,
  subtitle,
  groups,
  q,
  account,
  clearHref,
}: {
  title: string;
  subtitle?: string | null;
  groups: MailboxGroups;
  q: string;
  account: string | null;
  clearHref: string;
}) {
  const [sheet, setSheet] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), { rootMargin: "-52px 0px 0px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    // display: contents so the sticky bar sticks for the whole list, not just this wrapper.
    <div className="contents md:hidden">
      <div
        className={cn(
          "sticky top-0 z-20 pt-[env(safe-area-inset-top)] transition-colors md:hidden",
          collapsed ? "border-b border-border bg-bg/85 backdrop-blur-xl" : "border-b border-transparent bg-bg",
        )}
      >
        <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center px-2">
          <button
            type="button"
            onClick={() => setSheet(true)}
            className="flex h-11 items-center justify-self-start pr-2 text-[17px] text-blue-600 active:opacity-50 dark:text-blue-400"
          >
            <ChevronLeft className="size-7" strokeWidth={2} />
            Mailboxes
          </button>
          <span className={cn("max-w-[10rem] truncate text-[17px] font-semibold transition-opacity", collapsed ? "opacity-100" : "opacity-0")}>
            {title}
          </span>
          <span />
        </div>
      </div>

      <div className="px-4 pb-2 md:hidden">
        <h1 ref={titleRef} className="text-[34px] font-bold leading-tight tracking-tight">
          {title}
        </h1>
        {subtitle ? <p className="-mt-0.5 truncate text-[15px] text-muted">{subtitle}</p> : null}
        <form action="/mail" role="search" className="mt-2 flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-[18px] -translate-y-1/2 text-subtle" strokeWidth={2} />
            <input
              name="q"
              type="search"
              enterKeyHint="search"
              defaultValue={q}
              key={q}
              placeholder="Search"
              aria-label="Search mail"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              className="h-10 w-full rounded-[10px] bg-surface-2 pl-9 pr-3 text-[17px] text-fg placeholder:text-subtle focus:outline-none"
            />
          </div>
          {account ? <input type="hidden" name="account" value={account} /> : null}
          {q ? (
            <Link href={clearHref} className="shrink-0 text-[17px] text-blue-600 dark:text-blue-400">
              Cancel
            </Link>
          ) : null}
        </form>
      </div>

      {sheet ? <MailboxesSheet groups={groups} onClose={() => setSheet(false)} /> : null}
    </div>
  );
}

function MailboxesSheet({ groups, onClose }: { groups: MailboxGroups; onClose: () => void }) {
  useEffect(() => {
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, []);

  const sections: { title: string | null; entries: MailboxEntry[] }[] = [
    { title: null, entries: groups.accounts.length > 2 ? groups.accounts : groups.accounts.slice(0, 1) },
    { title: "Mailboxes", entries: groups.views.filter((v) => v.key !== "inbox") },
    { title: "Inbox categories", entries: groups.categories },
    ...(groups.labels.length ? [{ title: "Labels", entries: groups.labels }] : []),
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label="Mailboxes" className="fixed inset-0 z-[65] flex flex-col bg-bg animate-sheet-up">
      <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <span />
        <h2 className="text-[17px] font-semibold">Mailboxes</h2>
        <button type="button" onClick={onClose} className="flex h-11 items-center justify-self-end text-[17px] font-semibold text-blue-600 active:opacity-50 dark:text-blue-400">
          Done
        </button>
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4">
        {sections.map((section) => (
          <section key={section.title ?? "accounts"} className="mb-6">
            {section.title ? <h3 className="mb-1.5 px-4 text-[13px] uppercase tracking-wide text-subtle">{section.title}</h3> : null}
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {section.entries.map((e) => {
                const Icon = MAILBOX_ICONS[e.icon];
                return (
                  <li key={e.key}>
                    <Link
                      href={e.href}
                      onClick={onClose}
                      aria-current={e.active ? "page" : undefined}
                      className={cn("flex min-h-[48px] items-center gap-3 pl-4 pr-3 active:bg-surface-2", e.active && "bg-surface-2")}
                    >
                      <span className="relative flex size-7 items-center justify-center text-blue-600 dark:text-blue-400">
                        <Icon className="size-[22px]" strokeWidth={1.75} style={e.color ? { color: e.color } : undefined} />
                        {e.dot ? <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface", e.dot)} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[17px]">{e.key === "all-accounts" ? "All Inboxes" : e.label}</span>
                        {e.hint ? <span className="block text-[13px] text-warning">{e.hint}</span> : null}
                      </span>
                      {e.count ? <span className="text-[17px] tabular-nums text-subtle">{e.count}</span> : null}
                      <ChevronRight className="size-5 shrink-0 text-subtle/70" strokeWidth={2} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
