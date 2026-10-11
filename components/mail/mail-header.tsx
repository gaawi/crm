"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { Archive, ChevronRight, CircleEllipsis, Loader2, Menu, Search, X } from "lucide-react";
import { VelaMark } from "@/components/brand/vela-logo";
import { TAB_TITLES } from "@/lib/mail/params";
import { cn } from "@/lib/utils";
import { useArchiveAll, type ArchiveAllScope } from "./archive-all";
import { MailAvatar } from "./mail-avatar";
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
 * Gmail for iPhone's list header: a pill search bar pinned at the top (☰
 * opens the Mailboxes sheet, the avatar on the right switches accounts), then
 * the mailbox name in small type with the "…" menu (Archive all, in the Inbox).
 */
export function PhoneMailHeader({
  title,
  subtitle,
  groups,
  q,
  account,
  clearHref,
  archiveAll = null,
}: {
  title: string;
  subtitle?: string | null;
  groups: MailboxGroups;
  q: string;
  account: string | null;
  clearHref: string;
  /** The Inbox (not search, not other views): the menu offers "Archive all". */
  archiveAll?: ArchiveAllScope | null;
}) {
  const [sheet, setSheet] = useState(false);
  const archiver = useArchiveAll(archiveAll);
  const current = groups.accounts.find((e) => e.active && e.key !== "all-accounts") ?? null;

  return (
    // display: contents so the sticky search bar sticks for the whole list, not just this wrapper.
    <div className="contents md:hidden">
      <div className="sticky top-0 z-20 bg-surface px-3 pb-1 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:hidden">
        <form action="/mail" role="search" className="flex h-14 items-center gap-1 rounded-full bg-surface-2 pl-1 pr-1.5">
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-label="Mailboxes"
            className="flex size-12 shrink-0 items-center justify-center rounded-full text-fg/80 active:bg-border"
          >
            <Menu className="size-6" strokeWidth={1.75} />
          </button>
          <input
            name="q"
            type="search"
            enterKeyHint="search"
            defaultValue={q}
            key={q}
            placeholder="Search in mail"
            aria-label="Search mail"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            className="h-12 min-w-0 flex-1 bg-transparent px-1 text-[17px] text-fg placeholder:text-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {account ? <input type="hidden" name="account" value={account} /> : null}
          {q ? (
            <Link href={clearHref} aria-label="Clear search" className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted active:bg-border">
              <X className="size-5" />
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-label={current ? `Account: ${current.label}` : "All inboxes — switch account"}
            className="flex size-11 shrink-0 items-center justify-center rounded-full active:opacity-70"
          >
            {current ? (
              <MailAvatar name={current.label} className="size-9 text-[17px]" />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-full bg-surface ring-1 ring-border">
                <VelaMark size={22} />
              </span>
            )}
          </button>
        </form>
      </div>

      <div className="flex min-h-10 items-center gap-2 pl-4 pr-2 pt-2 md:hidden">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-medium tracking-wide text-muted">{title}</h1>
          {subtitle ? <p className="truncate text-[13px] text-subtle">{subtitle}</p> : null}
        </div>
        {archiveAll || archiver.running ? (
          <ListMenu
            items={[
              {
                label: archiver.running ? "Archiving…" : "Archive all",
                detail: archiveAll ? `${TAB_TITLES[archiveAll.tab]} · ${archiveAll.accountLabel}` : null,
                icon: archiver.running ? Spinner : Archive,
                run: archiver.start,
              },
            ]}
          />
        ) : null}
      </div>

      {sheet ? <MailboxesSheet groups={groups} onClose={() => setSheet(false)} /> : null}
      {archiver.dialog}
    </div>
  );
}

interface ListMenuItem {
  label: string;
  detail?: string | null;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  run: () => void;
}

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn(className, "animate-spin")} />;
}

/**
 * iOS pull-down menu behind the "…" button of the list header. Portaled (the
 * collapsed header's backdrop blur would trap a fixed overlay), closed by a
 * tap outside or Escape; focus goes to the first item and back to the button.
 */
function ListMenu({ items }: { items: ListMenuItem[] }) {
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = anchor !== null;

  useEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setAnchor(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (button?.isConnected) button.focus({ preventScroll: true });
    };
  }, [open]);

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (open || !rect) {
      setAnchor(null);
      return;
    }
    setAnchor({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-11 items-center justify-center justify-self-end rounded-full text-muted active:bg-surface-2"
      >
        <CircleEllipsis className="size-[26px]" strokeWidth={1.75} />
      </button>
      {anchor
        ? createPortal(
            <div className="fixed inset-0 z-[65]" onClick={() => setAnchor(null)}>
              <div
                ref={menuRef}
                role="menu"
                aria-label="List actions"
                onClick={(e) => e.stopPropagation()}
                style={{ top: anchor.top, right: anchor.right }}
                className="absolute w-64 origin-top-right overflow-hidden rounded-[14px] bg-surface text-fg shadow-[0_12px_40px_rgba(0,0,0,0.22)] ring-1 ring-black/5 transition-[opacity,scale] duration-150 starting:scale-90 starting:opacity-0 dark:ring-white/10"
              >
                {items.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAnchor(null);
                        item.run();
                      }}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left outline-none active:bg-surface-2 focus-visible:bg-surface-2",
                        i > 0 && "border-t border-border",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] leading-snug">{item.label}</span>
                        {item.detail ? <span className="block truncate text-[13px] text-muted">{item.detail}</span> : null}
                      </span>
                      <Icon className="size-5 shrink-0" strokeWidth={1.75} />
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
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
