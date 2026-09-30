"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Info,
  Mail,
  MailOpen,
  MessagesSquare,
  Paperclip,
  RotateCw,
  Star,
  Tag,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { formatListDate, formatSenders, type SenderPart } from "@/lib/mail/format";
import { threadHref, type InboxTab, type MailListState } from "@/lib/mail/params";
import type { ThreadAction } from "@/lib/mail/gmail";
import type { ThreadSummary } from "@/lib/mail/queries";
import { cn } from "@/lib/utils";
import { useMail, type ThreadTarget } from "./mail-provider";
import { SwipeRow } from "./swipe-row";
import { useShortcuts } from "./use-shortcuts";

export interface LabelInfo {
  name: string;
  color: string | null;
}

export interface TabInfo {
  tab: InboxTab;
  label: string;
  unread: number;
  href: string;
  active: boolean;
}

type Row = ThreadSummary & { inInbox: boolean };

const TOASTS: Partial<Record<ThreadAction, [string, string]>> = {
  archive: ["Conversation archived.", "conversations archived."],
  trash: ["Conversation moved to Trash.", "conversations moved to Trash."],
  untrash: ["Conversation restored.", "conversations restored."],
  inbox: ["Conversation moved to Inbox.", "conversations moved to Inbox."],
};

/**
 * The thread list: Gmail rows with checkboxes, stars and hover actions on
 * desktop (with bulk actions, tabs, pagination and j/k shortcuts), iPhone
 * Mail rows with swipe actions on phones. Changes are optimistic; a failed
 * Gmail call brings the row back with an error toast.
 */
export function ThreadList({
  threads,
  state,
  now,
  range,
  tabs,
  accountDots,
  showAccount,
  labels,
  emptyTitle,
  emptyText,
}: {
  threads: ThreadSummary[];
  state: MailListState;
  now: number;
  range: { start: number; end: number; prevHref: string | null; nextHref: string | null };
  tabs: TabInfo[] | null;
  accountDots: Record<string, string>;
  showAccount: boolean;
  labels: Record<string, LabelInfo>;
  emptyTitle: string;
  emptyText: string;
}) {
  const router = useRouter();
  const { overrides, act, settle, compose, timezone } = useMail();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(-1);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const nowDate = useMemo(() => new Date(now), [now]);
  const searching = Boolean(state.q);

  useEffect(() => {
    settle(threads.map((t) => ({ key: t.key, lastAt: new Date(t.lastAt).getTime(), unread: t.unread, starred: t.starred })));
  }, [threads, settle]);

  const rows: Row[] = useMemo(
    () =>
      threads
        .map((t) => {
          const o = overrides[t.key];
          const base = { ...t, inInbox: t.labelIds.includes("INBOX") };
          if (!o || (o.lastAt !== 0 && o.lastAt !== new Date(t.lastAt).getTime())) return base;
          return { ...base, unread: o.unread ?? t.unread, starred: o.starred ?? t.starred, hidden: o.hidden };
        })
        .filter((t) => !("hidden" in t && t.hidden)),
    [threads, overrides],
  );

  // Selection only keeps visible rows.
  const selectedRows = rows.filter((r) => selected.has(r.key));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  const target = (r: Row): ThreadTarget => ({ key: r.key, accountId: r.accountId, threadId: r.threadId, lastAt: new Date(r.lastAt).getTime() });

  function hides(action: ThreadAction): boolean {
    if (action === "archive") return state.view === "inbox" && !searching;
    if (action === "trash") return state.view !== "trash";
    if (action === "untrash") return state.view === "trash";
    return false;
  }

  async function run(list: Row[], action: ThreadAction) {
    if (!list.length) return;
    const texts = TOASTS[action];
    const undo: ThreadAction[] | undefined =
      action === "archive" ? ["inbox"] : action === "trash" ? (list.some((r) => r.inInbox) ? ["untrash", "inbox"] : ["untrash"]) : action === "untrash" ? ["trash"] : action === "inbox" ? ["archive"] : undefined;
    setSelected((prev) => {
      if (!hides(action)) return prev;
      const next = new Set(prev);
      for (const r of list) next.delete(r.key);
      return next;
    });
    await act(list.map(target), action, {
      hide: hides(action),
      toast: texts ? (list.length === 1 ? texts[0] : `${list.length} ${texts[1]}`) : undefined,
      undo,
    });
  }

  const cursorRow = cursor >= 0 ? rows[Math.min(cursor, rows.length - 1)] : undefined;
  const targets = () => (selectedRows.length ? selectedRows : cursorRow ? [cursorRow] : []);
  const href = (r: Row) => threadHref(r.accountId, r.threadId, state);

  function moveCursor(delta: number) {
    if (!rows.length) return;
    const next = Math.max(0, Math.min(rows.length - 1, (cursor < 0 ? (delta > 0 ? -1 : rows.length) : cursor) + delta));
    setCursor(next);
    listRef.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useShortcuts({
    j: () => moveCursor(1),
    k: () => moveCursor(-1),
    o: () => cursorRow && router.push(href(cursorRow)),
    Enter: () => cursorRow && router.push(href(cursorRow)),
    x: () => cursorRow && toggle(cursorRow.key),
    e: () => void run(targets().filter((r) => r.inInbox), "archive"),
    "#": () => void run(targets(), state.view === "trash" ? "untrash" : "trash"),
    s: () => cursorRow && void run([cursorRow], cursorRow.starred ? "unstar" : "star"),
    U: () => void run(targets(), "unread"),
    I: () => void run(targets(), "read"),
    c: () => compose({ accountId: state.account }),
    "/": () => document.getElementById("mail-search")?.focus(),
  });

  function refresh() {
    setRefreshing(true);
    startTransition(() => {
      router.refresh();
      window.setTimeout(() => setRefreshing(false), 600);
    });
  }

  const categoryRows = tabs && state.tab === "primary" ? tabs.filter((t) => t.tab !== "primary" && t.unread > 0) : [];
  const inTrash = state.view === "trash" && !searching;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Desktop toolbar */}
      <div className="hidden h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-3 md:flex">
        <label className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-surface-2" title="Select all">
          <input
            type="checkbox"
            aria-label="Select all"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = selectedRows.length > 0 && !allSelected;
            }}
            onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)))}
            className="size-4 accent-current"
          />
        </label>
        {selectedRows.length ? (
          <>
            {!inTrash && selectedRows.some((r) => r.inInbox) ? (
              <ToolButton label="Archive (e)" onClick={() => run(selectedRows.filter((r) => r.inInbox), "archive")}>
                <Archive className="size-4" />
              </ToolButton>
            ) : null}
            {!inTrash && selectedRows.some((r) => !r.inInbox) ? (
              <ToolButton label="Move to Inbox" onClick={() => run(selectedRows.filter((r) => !r.inInbox), "inbox")}>
                <Inbox className="size-4" />
              </ToolButton>
            ) : null}
            {inTrash ? (
              <ToolButton label="Restore" onClick={() => run(selectedRows, "untrash")}>
                <Undo2 className="size-4" />
              </ToolButton>
            ) : (
              <ToolButton label="Delete (#)" onClick={() => run(selectedRows, "trash")}>
                <Trash2 className="size-4" />
              </ToolButton>
            )}
            <span className="mx-1 h-5 w-px bg-border" />
            {selectedRows.some((r) => r.unread) ? (
              <ToolButton label="Mark as read (Shift+I)" onClick={() => run(selectedRows.filter((r) => r.unread), "read")}>
                <MailOpen className="size-4" />
              </ToolButton>
            ) : null}
            {selectedRows.some((r) => !r.unread) ? (
              <ToolButton label="Mark as unread (Shift+U)" onClick={() => run(selectedRows.filter((r) => !r.unread), "unread")}>
                <Mail className="size-4" />
              </ToolButton>
            ) : null}
            <span className="ml-2 text-xs text-muted">{selectedRows.length} selected</span>
          </>
        ) : (
          <ToolButton label="Refresh" onClick={refresh}>
            <RotateCw className={cn("size-4", refreshing && "animate-spin")} />
          </ToolButton>
        )}
        <span className="flex-1" />
        {rows.length ? (
          <span className="text-xs tabular-nums text-muted">
            {range.start}–{range.start + threads.length - 1}
          </span>
        ) : null}
        <PageLink href={range.prevHref} label="Newer">
          <ChevronLeft className="size-4" />
        </PageLink>
        <PageLink href={range.nextHref} label="Older">
          <ChevronRight className="size-4" />
        </PageLink>
      </div>

      {/* Desktop inbox tabs */}
      {tabs ? (
        <nav aria-label="Inbox categories" className="hidden shrink-0 border-b border-border bg-surface md:flex">
          {tabs.map((t) => (
            <Link
              key={t.tab}
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={cn(
                "relative flex h-11 min-w-0 flex-1 items-center gap-2 px-3 text-sm lg:max-w-60 lg:px-4",
                t.active ? "font-medium text-blue-600 dark:text-blue-400" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <span className="truncate">{t.label}</span>
              {t.unread ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 text-[11px] font-semibold leading-4",
                    t.active ? "bg-blue-600 text-white dark:bg-blue-400 dark:text-zinc-950" : "bg-surface-2 text-muted",
                  )}
                >
                  {t.unread}
                  <span className="hidden xl:inline"> new</span>
                </span>
              ) : null}
              {t.active ? <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t bg-blue-600 dark:bg-blue-400" /> : null}
            </Link>
          ))}
        </nav>
      ) : null}

      <div ref={listRef} className="md:min-h-0 md:flex-1 md:overflow-y-auto" role="list" aria-label="Conversations">
        {/* Phone: Gmail-iOS style bundles at the top of Primary */}
        {categoryRows.length ? (
          <ul className="border-b border-border bg-surface md:hidden">
            {categoryRows.map((t) => (
              <li key={t.tab}>
                <Link href={t.href} className="flex min-h-[52px] items-center gap-3 px-4 active:bg-surface-2">
                  <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-muted">
                    <CategoryIcon tab={t.tab} />
                  </span>
                  <span className="flex-1 text-[17px] font-semibold">{t.label}</span>
                  <span className="rounded-full bg-blue-600 px-2 text-[13px] font-semibold leading-6 text-white">{t.unread} new</span>
                  <ChevronRight className="size-5 text-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-16 text-center">
            <p className="text-[17px] font-medium text-fg md:text-sm">{emptyTitle}</p>
            <p className="max-w-sm text-[15px] text-muted md:text-sm">{emptyText}</p>
          </div>
        ) : null}

        {rows.map((r, i) => {
          const senders = formatSenders(r.senders, r.messageCount);
          const toContact = r.senders.length > 0 && r.senders.every((s) => s.outbound) && r.contact;
          const chips = r.labelIds
            .map((id) => labels[`${r.accountId}:${id}`])
            .filter((l): l is LabelInfo => Boolean(l));
          const showInboxChip = (searching || state.view === "all" || state.view === "starred" || state.view === "important") && r.inInbox;
          const date = new Date(r.lastAt);
          const readAction: ThreadAction = r.unread ? "read" : "unread";
          return (
            <div key={r.key} role="listitem">
              {/* Desktop row */}
              <div
                data-row={i}
                className={cn(
                  "group relative hidden h-10 items-center border-b border-border pl-1 pr-3 text-sm md:flex",
                  r.unread ? "bg-surface" : "bg-bg",
                  selected.has(r.key) && "bg-blue-50 dark:bg-blue-950/50",
                  "hover:z-10 hover:shadow-[inset_1px_0_0_var(--border),inset_-1px_0_0_var(--border),0_1px_3px_rgba(0,0,0,.12)]",
                )}
              >
                {cursor === i ? <span className="absolute inset-y-0 left-0 w-[3px] bg-blue-600 dark:bg-blue-400" aria-hidden /> : null}
                <label className="relative z-10 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-surface-2">
                  <input
                    type="checkbox"
                    aria-label="Select conversation"
                    checked={selected.has(r.key)}
                    onChange={() => toggle(r.key)}
                    className="size-4 accent-current"
                  />
                </label>
                <button
                  type="button"
                  aria-label={r.starred ? "Unstar" : "Star"}
                  aria-pressed={r.starred}
                  onClick={() => run([r], r.starred ? "unstar" : "star")}
                  className="relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg"
                >
                  <Star className={cn("size-4", r.starred && "fill-amber-400 text-amber-400")} strokeWidth={1.75} />
                </button>
                <Link
                  href={href(r)}
                  data-bare
                  className="flex min-w-0 flex-1 items-center gap-3 pl-1 after:absolute after:inset-0"
                  onFocus={() => setCursor(i)}
                >
                  <span className={cn("w-44 shrink-0 truncate lg:w-52", r.unread ? "font-semibold text-fg" : "text-fg/80")}>
                    {toContact ? <span className="font-normal text-muted">To: </span> : null}
                    {toContact ? toContact.displayName : <Senders parts={senders.parts} />}
                    {senders.count ? <span className="ml-1 text-xs font-normal text-muted">{senders.count}</span> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    {showInboxChip ? <Chip>Inbox</Chip> : null}
                    {chips.map((l) => (
                      <Chip key={l.name} color={l.color}>
                        {l.name}
                      </Chip>
                    ))}
                    <span className="min-w-0 truncate">
                      <span className={cn(r.unread ? "font-semibold text-fg" : "text-fg/80")}>{r.subject?.trim() || "(no subject)"}</span>
                      {r.snippet ? <span className="text-muted"> — {r.snippet}</span> : null}
                    </span>
                  </span>
                </Link>
                <span className="relative z-10 ml-2 flex shrink-0 items-center gap-2 group-hover:pointer-events-none">
                  {r.contact && !toContact ? (
                    <Link href={`/contacts/${r.contact.id}`} className="pointer-events-auto hidden xl:inline-flex" title={`CRM: ${r.contact.displayName}`}>
                      <StatusBadge status={r.contact.status} />
                    </Link>
                  ) : null}
                  {r.hasAttachments ? <Paperclip className="size-3.5 text-subtle" aria-label="Has attachments" /> : null}
                  {showAccount ? <span className={cn("size-2 rounded-full", accountDots[r.accountId])} title={r.accountEmail} /> : null}
                  <span className={cn("w-16 text-right text-xs tabular-nums group-hover:invisible", r.unread ? "font-semibold text-fg" : "text-muted")}>
                    {formatListDate(date, timezone, nowDate)}
                  </span>
                </span>
                {/* Hover actions (over the date) */}
                <span className="absolute right-2 z-20 hidden items-center gap-0.5 bg-inherit group-hover:flex">
                  {inTrash ? (
                    <RowAction label="Restore" onClick={() => run([r], "untrash")}>
                      <Undo2 className="size-4" />
                    </RowAction>
                  ) : r.inInbox ? (
                    <RowAction label="Archive" onClick={() => run([r], "archive")}>
                      <Archive className="size-4" />
                    </RowAction>
                  ) : (
                    <RowAction label="Move to Inbox" onClick={() => run([r], "inbox")}>
                      <ArchiveRestore className="size-4" />
                    </RowAction>
                  )}
                  {!inTrash ? (
                    <RowAction label="Delete" onClick={() => run([r], "trash")}>
                      <Trash2 className="size-4" />
                    </RowAction>
                  ) : null}
                  <RowAction label={r.unread ? "Mark as read" : "Mark as unread"} onClick={() => run([r], readAction)}>
                    {r.unread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
                  </RowAction>
                </span>
              </div>

              {/* Phone row */}
              <SwipeRow
                className="md:hidden"
                open={openRow === r.key}
                onOpenChange={(open) => setOpenRow(open ? r.key : null)}
                leading={{
                  label: r.unread ? "Read" : "Unread",
                  icon: r.unread ? MailOpen : Mail,
                  tone: "bg-blue-600",
                  run: () => void run([r], readAction),
                }}
                secondary={
                  inTrash
                    ? undefined
                    : { label: "Trash", icon: Trash2, tone: "bg-red-600", removes: hides("trash"), run: () => void run([r], "trash") }
                }
                primary={
                  inTrash
                    ? { label: "Restore", icon: Undo2, tone: "bg-blue-600", removes: hides("untrash"), run: () => void run([r], "untrash") }
                    : r.inInbox
                      ? { label: "Archive", icon: Archive, tone: "bg-violet-600", removes: hides("archive"), run: () => void run([r], "archive") }
                      : { label: "Trash", icon: Trash2, tone: "bg-red-600", removes: hides("trash"), run: () => void run([r], "trash") }
                }
              >
                <Link href={href(r)} className="flex gap-2 pl-2 active:bg-surface-2" draggable={false}>
                  <span className="flex w-4 shrink-0 justify-center pt-[19px]">
                    {r.unread ? <span className="size-2.5 rounded-full bg-blue-500" aria-label="Unread" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 border-b border-border py-2.5 pr-4">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-fg">
                        {toContact ? `To: ${toContact.displayName}` : senders.parts.map((p) => p.text).join(senders.parts.length > 1 ? ", " : "").replace(", .., ", " .. ")}
                        {senders.count ? <span className="ml-1 text-[15px] font-normal text-subtle">{senders.count}</span> : null}
                      </span>
                      {r.hasAttachments ? <Paperclip className="size-3.5 shrink-0 text-subtle" /> : null}
                      <span className="shrink-0 text-[15px] tabular-nums text-subtle">{formatListDate(date, timezone, nowDate, "ios")}</span>
                      <ChevronRight className="-mr-1 size-4 shrink-0 text-subtle/70" strokeWidth={2.25} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{r.subject?.trim() || "(no subject)"}</span>
                      {r.starred ? <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" /> : null}
                    </span>
                    <span className="line-clamp-2 text-[15px] leading-snug text-muted">{r.snippet || " "}</span>
                  </span>
                </Link>
              </SwipeRow>
            </div>
          );
        })}

        {/* Phone pagination */}
        {range.prevHref || range.nextHref ? (
          <div className="flex items-center justify-between px-4 py-4 md:hidden">
            {range.prevHref ? (
              <Link href={range.prevHref} className="flex h-11 items-center gap-1 text-[17px] text-blue-600 dark:text-blue-400">
                <ChevronLeft className="size-5" /> Newer
              </Link>
            ) : (
              <span />
            )}
            {range.nextHref ? (
              <Link href={range.nextHref} className="flex h-11 items-center gap-1 text-[17px] text-blue-600 dark:text-blue-400">
                Older <ChevronRight className="size-5" />
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Senders({ parts }: { parts: SenderPart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={p.unread ? "font-semibold" : "font-normal"}>
          {p.text === ".." ? " .. " : `${i > 0 && parts[i - 1].text !== ".." ? ", " : ""}${p.text}`}
        </span>
      ))}
    </>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color?: string | null }) {
  return (
    <span className="inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded bg-surface-2 px-1.5 text-[11px] font-medium text-muted">
      {color ? <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </button>
  );
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="pointer-events-auto inline-flex size-8 items-center justify-center rounded-full text-muted hover:bg-border hover:text-fg"
    >
      {children}
    </button>
  );
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href) {
    return (
      <span aria-disabled className="inline-flex size-8 items-center justify-center text-subtle/50" title={label}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} title={label} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
      {children}
    </Link>
  );
}

export function CategoryIcon({ tab, className = "size-4" }: { tab: InboxTab; className?: string }) {
  const Icon = { primary: Inbox, promotions: Tag, social: Users, updates: Info, forums: MessagesSquare }[tab];
  return <Icon className={className} strokeWidth={1.75} />;
}
