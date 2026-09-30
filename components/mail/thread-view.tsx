"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  Download,
  Ellipsis,
  ExternalLink,
  FileText,
  Forward,
  ImageOff,
  Mail,
  Paperclip,
  Reply,
  ReplyAll,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react";
import { labelAction } from "@/app/(app)/mail/actions";
import { Dropdown } from "@/app/(app)/_components/dropdown";
import { hasReplyAll } from "@/lib/mail/compose";
import { displayName, firstName, formatBytes, formatFullDate, formatMessageDate } from "@/lib/mail/format";
import type { ThreadAction } from "@/lib/mail/gmail";
import { cn, initials } from "@/lib/utils";
import { EmailFrame } from "./email-frame";
import { useMail } from "./mail-provider";
import { composeFor } from "./reply-init";
import type { ThreadLabelOption, ThreadMessageView, ThreadViewData } from "./thread-types";
import { useShortcuts } from "./use-shortcuts";

const menuItem =
  "flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[15px] text-fg active:bg-surface-2 md:h-8 md:rounded-md md:px-2.5 md:text-sm md:hover:bg-surface-2";

/**
 * One conversation: toolbar (archive, trash, unread, labels, star), subject
 * and labels, messages (older ones collapsed), Reply / Reply all / Forward.
 * Actions are optimistic and go back to the list like Gmail.
 */
export function ThreadView({
  thread,
  backHref,
  backLabel,
  hideOnLeave,
  userLabels,
  now,
  notice,
}: {
  notice?: string | null;
  thread: ThreadViewData;
  backHref: string;
  backLabel: string;
  /** The list we came from drops archived/trashed threads (Inbox). */
  hideOnLeave: { archive: boolean; trash: boolean };
  userLabels: ThreadLabelOption[];
  now: number;
}) {
  const router = useRouter();
  const { act, compose, ownAddresses, timezone, toast } = useMail();
  const own = useMemo(() => new Set(ownAddresses), [ownAddresses]);
  const nowDate = useMemo(() => new Date(now), [now]);
  const [labels, setLabels] = useState(thread.labelIds);
  const [starred, setStarred] = useState(thread.messages.some((m) => m.starred));
  const messages = thread.messages;
  const latest = messages[messages.length - 1];
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(messages.filter((m, i) => i === messages.length - 1 || m.unread).map((m) => m.id)));
  const [showRuns, setShowRuns] = useState(false);

  const inInbox = labels.includes("INBOX");
  const inTrash = labels.includes("TRASH");
  const target = { key: thread.key, accountId: thread.accountId, threadId: thread.threadId, lastAt: 0 };
  const chips = userLabels.filter((l) => labels.includes(l.id));

  function leave(action: ThreadAction, hide: boolean, message: string, undo: ThreadAction[]) {
    void act([target], action, { hide, toast: message, undo });
    router.push(backHref);
  }

  const archive = () => inInbox && leave("archive", hideOnLeave.archive, "Conversation archived.", ["inbox"]);
  const trash = () => !inTrash && leave("trash", hideOnLeave.trash, "Conversation moved to Trash.", inInbox ? ["untrash", "inbox"] : ["untrash"]);
  const markUnread = () => leave("unread", false, "Marked as unread.", ["read"]);

  async function change(action: ThreadAction, apply: () => void, revert: () => void) {
    apply();
    const ok = await act([target], action);
    if (!ok) revert();
  }

  const toggleStar = () =>
    change(starred ? "unstar" : "star", () => setStarred(!starred), () => setStarred(starred));
  const moveToInbox = () =>
    change("inbox", () => setLabels((l) => [...new Set([...l, "INBOX"])]), () => setLabels(thread.labelIds));
  const restore = () =>
    change("untrash", () => setLabels((l) => l.filter((x) => x !== "TRASH")), () => setLabels(thread.labelIds));

  async function toggleLabel(id: string) {
    const has = labels.includes(id);
    const before = labels;
    setLabels(has ? labels.filter((l) => l !== id) : [...labels, id]);
    const result = await labelAction(thread.accountId, thread.threadId, has ? [] : [id], has ? [id] : []);
    if (!result.ok) {
      setLabels(before);
      toast({ tone: "error", message: result.error });
    } else startTransition(() => router.refresh());
  }

  const reply = (kind: "reply" | "reply_all" | "forward", message: ThreadMessageView = latest) =>
    compose(composeFor(kind, thread, message, own, timezone));
  const canReplyAll = latest ? hasReplyAll(latest, own) : false;

  useShortcuts({
    u: () => router.push(backHref),
    e: archive,
    "#": trash,
    U: markUnread,
    s: () => void toggleStar(),
    r: () => reply("reply"),
    a: () => reply(canReplyAll ? "reply_all" : "reply"),
    f: () => reply("forward"),
    c: () => compose({ accountId: thread.accountId }),
    "/": () => document.getElementById("mail-search")?.focus(),
  });

  // Runs of 3+ collapsed messages after the first become "N older messages".
  const items: ({ type: "message"; message: ThreadMessageView } | { type: "run"; count: number; ids: string[] })[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i > 0 && !showRuns && !expanded.has(m.id)) {
      let j = i;
      while (j < messages.length && !expanded.has(messages[j].id)) j++;
      if (j - i >= 3) {
        items.push({ type: "run", count: j - i, ids: messages.slice(i, j).map((x) => x.id) });
        i = j - 1;
        continue;
      }
    }
    items.push({ type: "message", message: m });
  }

  const toggleMessage = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const labelMenu = userLabels.length ? (
    <>
      <p className="px-3 pb-1 pt-2 text-[13px] text-subtle md:px-2.5 md:text-xs">Labels</p>
      {userLabels.map((l) => (
        <button key={l.id} type="button" onClick={() => void toggleLabel(l.id)} className={menuItem}>
          <input type="checkbox" readOnly checked={labels.includes(l.id)} tabIndex={-1} className="pointer-events-none size-4 accent-current" />
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: l.color ?? "var(--subtle)" }} />
          <span className="truncate">{l.name}</span>
        </button>
      ))}
    </>
  ) : (
    <p className="px-3 py-2 text-[13px] text-subtle md:px-2.5 md:text-xs">No labels in this account.</p>
  );

  return (
    // Phones: display: contents lets the navigation bar stay pinned over the Contact section too.
    <div className="min-w-0 max-md:contents">
      {/* Phone navigation bar */}
      <div className="sticky top-0 z-20 border-b border-border bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden">
        <div className="flex h-11 items-center gap-1 pl-1 pr-2">
          <Link href={backHref} className="flex h-11 min-w-0 items-center pr-2 text-[17px] text-blue-600 active:opacity-50 dark:text-blue-400">
            <ChevronLeft className="size-7 shrink-0" strokeWidth={2} />
            <span className="truncate">{backLabel}</span>
          </Link>
          <span className="flex-1" />
          {inTrash ? (
            <BarButton label="Restore" onClick={() => void restore()}>
              <Undo2 className="size-[22px]" />
            </BarButton>
          ) : inInbox ? (
            <BarButton label="Archive" onClick={archive}>
              <Archive className="size-[22px]" />
            </BarButton>
          ) : (
            <BarButton label="Move to Inbox" onClick={() => void moveToInbox()}>
              <ArchiveRestore className="size-[22px]" />
            </BarButton>
          )}
          {!inTrash ? (
            <BarButton label="Trash" onClick={trash}>
              <Trash2 className="size-[22px]" />
            </BarButton>
          ) : null}
          <BarButton label="Mark as unread" onClick={markUnread}>
            <Mail className="size-[22px]" />
          </BarButton>
          <Dropdown
            label="More"
            trigger={<Ellipsis className="size-[22px]" strokeWidth={1.75} />}
            summaryClassName="flex size-11 cursor-pointer items-center justify-center rounded-full text-blue-600 active:opacity-50 dark:text-blue-400"
            panelClassName="right-0 mt-1 w-64"
          >
            <button type="button" onClick={() => void toggleStar()} className={menuItem}>
              <Star className={cn("size-4", starred && "fill-amber-400 text-amber-400")} />
              {starred ? "Remove star" : "Star"}
            </button>
            {inInbox ? null : !inTrash ? (
              <button type="button" onClick={() => void moveToInbox()} className={menuItem}>
                <ArchiveRestore className="size-4" /> Move to Inbox
              </button>
            ) : null}
            <a href={thread.gmailUrl} target="_blank" rel="noopener noreferrer" className={menuItem}>
              <ExternalLink className="size-4" /> Open in Gmail
            </a>
            <div className="my-1 border-t border-border" />
            {labelMenu}
          </Dropdown>
        </div>
      </div>

      {/* Desktop toolbar */}
      <div className="sticky top-0 z-20 hidden h-12 items-center gap-1 border-b border-border bg-surface px-3 md:flex">
        <ToolLink href={backHref} label={`Back to ${backLabel} (u)`}>
          <ArrowLeft className="size-4" />
        </ToolLink>
        <span className="mx-1 h-5 w-px bg-border" />
        {inTrash ? (
          <Tool label="Restore" onClick={() => void restore()}>
            <Undo2 className="size-4" />
          </Tool>
        ) : inInbox ? (
          <Tool label="Archive (e)" onClick={archive}>
            <Archive className="size-4" />
          </Tool>
        ) : (
          <Tool label="Move to Inbox" onClick={() => void moveToInbox()}>
            <ArchiveRestore className="size-4" />
          </Tool>
        )}
        {!inTrash ? (
          <Tool label="Delete (#)" onClick={trash}>
            <Trash2 className="size-4" />
          </Tool>
        ) : null}
        <Tool label="Mark as unread (Shift+U)" onClick={markUnread}>
          <Mail className="size-4" />
        </Tool>
        <Dropdown label="Labels" trigger={<Tag className="size-4" strokeWidth={1.75} />} panelClassName="left-0 mt-1 w-60">
          {labelMenu}
        </Dropdown>
        <Tool label={starred ? "Remove star (s)" : "Star (s)"} onClick={() => void toggleStar()}>
          <Star className={cn("size-4", starred && "fill-amber-400 text-amber-400")} />
        </Tool>
        <span className="flex-1" />
        <a
          href={thread.gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted hover:bg-surface-2 hover:text-fg"
        >
          Open in Gmail <ExternalLink className="size-3.5" />
        </a>
      </div>

      {notice ? (
        <p role="status" className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 md:mx-6 md:text-xs">
          {notice}
        </p>
      ) : null}

      <div className="px-4 pt-4 md:px-6 md:pt-5">
        <h1 className="text-[22px] font-semibold leading-snug tracking-tight text-fg md:font-normal">{thread.subject?.trim() || "(no subject)"}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {inInbox ? <LabelChip>Inbox</LabelChip> : null}
          {inTrash ? <LabelChip>Trash</LabelChip> : null}
          {labels.includes("IMPORTANT") ? <LabelChip>Important</LabelChip> : null}
          {chips.map((l) => (
            <LabelChip key={l.id} color={l.color}>
              {l.name}
            </LabelChip>
          ))}
          <span className="text-[13px] text-subtle md:text-xs">{thread.accountEmail}</span>
        </div>
      </div>

      <div className="mt-3 border-t border-border md:mx-6 md:mt-4 md:border-t-0">
        {items.map((item) =>
          item.type === "run" ? (
            <button
              key={`run-${item.ids[0]}`}
              type="button"
              onClick={() => setShowRuns(true)}
              className="relative flex h-10 w-full items-center justify-center border-b border-border text-[13px] text-muted hover:bg-surface-2 md:text-xs"
            >
              <span className="rounded-full border border-border bg-surface px-3 py-1">{item.count} older messages</span>
            </button>
          ) : (
            <MessageItem
              key={item.message.id}
              message={item.message}
              thread={thread}
              expanded={expanded.has(item.message.id)}
              isLast={item.message.id === latest?.id}
              onToggle={() => toggleMessage(item.message.id)}
              onReply={(kind) => reply(kind, item.message)}
              own={own}
              timezone={timezone}
              now={nowDate}
            />
          ),
        )}
      </div>

      {latest ? (
        <div className="grid grid-cols-3 gap-2 px-4 py-5 md:flex md:flex-wrap md:px-6">
          <ReplyButton onClick={() => reply("reply")} icon={Reply}>
            Reply
          </ReplyButton>
          {canReplyAll ? (
            <ReplyButton onClick={() => reply("reply_all")} icon={ReplyAll}>
              Reply all
            </ReplyButton>
          ) : null}
          <ReplyButton onClick={() => reply("forward")} icon={Forward}>
            Forward
          </ReplyButton>
          <button
            type="button"
            onClick={() => compose({ ...composeFor("reply", thread, latest, own, timezone), claude: { instructions: "" } })}
            className="col-span-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-accent text-[17px] font-semibold text-accent-fg active:opacity-80 md:hidden"
          >
            <Sparkles className="size-5" strokeWidth={2} />
            Draft reply with Claude
          </button>
        </div>
      ) : null}
    </div>
  );
}

function recipientSummary(m: ThreadMessageView, own: ReadonlySet<string>): string {
  const names = [...m.to, ...m.cc].map((a) => (own.has(a.email) ? "me" : firstName(displayName(a))));
  const unique = [...new Set(names)];
  if (!unique.length) return "to (undisclosed recipients)";
  return `to ${unique.slice(0, 4).join(", ")}${unique.length > 4 ? ` +${unique.length - 4}` : ""}`;
}

function MessageItem({
  message: m,
  thread,
  expanded,
  isLast,
  onToggle,
  onReply,
  own,
  timezone,
  now,
}: {
  message: ThreadMessageView;
  thread: ThreadViewData;
  expanded: boolean;
  isLast: boolean;
  onToggle: () => void;
  onReply: (kind: "reply" | "reply_all" | "forward") => void;
  own: ReadonlySet<string>;
  timezone: string;
  now: Date;
}) {
  const [details, setDetails] = useState(false);
  const [quoted, setQuoted] = useState(false);
  const name = m.outbound ? "me" : m.from ? displayName(m.from) : "(unknown sender)";
  const senderName = m.from ? displayName(m.from) : "(unknown sender)";

  if (!expanded) {
    const shortDate = formatMessageDate(m.date, timezone, now).replace(/ \(.*\)$/, "");
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left active:bg-surface-2 md:px-0 md:py-2.5"
      >
        <MessageAvatar name={senderName} />
        <span className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-3">
          <span className="flex min-w-0 items-baseline gap-2 md:w-40 md:shrink-0">
            <span className={cn("min-w-0 flex-1 truncate text-[17px] md:text-sm", m.unread ? "font-semibold" : "font-medium")}>{name}</span>
            <span className="shrink-0 text-[13px] text-subtle md:hidden">{shortDate.replace(/^\w+, /, "")}</span>
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] text-muted md:text-sm">{m.snippet}</span>
        </span>
        <span className="hidden shrink-0 text-xs text-subtle md:inline">{shortDate}</span>
      </button>
    );
  }

  const body = quoted || !m.textWithoutQuotes ? m.text : m.textWithoutQuotes;
  const hasQuoted = Boolean(m.text && m.textWithoutQuotes && m.textWithoutQuotes.trim() !== m.text.trim());

  return (
    <article className="border-b border-border px-4 py-4 md:px-0" aria-label={`Message from ${senderName}`}>
      <header className="flex items-start gap-3">
        <MessageAvatar name={senderName} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <button type="button" onClick={isLast ? undefined : onToggle} className={cn("truncate text-[17px] font-semibold md:text-sm", isLast && "cursor-default")}>
              {senderName}
            </button>
            {m.from ? <span className="hidden truncate text-xs text-muted md:inline">&lt;{m.from.email}&gt;</span> : null}
          </div>
          <button
            type="button"
            onClick={() => setDetails((v) => !v)}
            aria-expanded={details}
            className="flex h-8 max-w-full items-center gap-0.5 text-[15px] text-muted hover:text-fg md:h-auto md:text-xs"
          >
            <span className="truncate">{recipientSummary(m, own)}</span>
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", details && "rotate-180")} />
          </button>
          {details ? (
            <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-lg border border-border bg-bg p-3 text-[13px] md:max-w-xl md:text-xs">
              <Detail label="from">{m.from ? `${m.from.name ? `${m.from.name} ` : ""}<${m.from.email}>` : "—"}</Detail>
              {m.replyTo.length ? <Detail label="reply-to">{m.replyTo.map((a) => a.email).join(", ")}</Detail> : null}
              <Detail label="to">{m.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ") || "—"}</Detail>
              {m.cc.length ? <Detail label="cc">{m.cc.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}</Detail> : null}
              <Detail label="date">{formatFullDate(m.date, timezone)}</Detail>
              <Detail label="account">{thread.accountEmail}</Detail>
            </dl>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <span className="hidden text-xs text-muted lg:inline">{formatMessageDate(m.date, timezone, now)}</span>
          <span className="text-[13px] text-subtle lg:hidden">{formatMessageDate(m.date, timezone, now).replace(/ \(.*\)$/, "").replace(/^\w+, /, "")}</span>
          <button
            type="button"
            onClick={() => onReply("reply")}
            aria-label="Reply"
            title="Reply"
            className="hidden size-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg md:inline-flex"
          >
            <Reply className="size-4" />
          </button>
          <Dropdown label="Message actions" trigger={<Ellipsis className="size-4" strokeWidth={1.75} />} panelClassName="right-0 mt-1 w-52">
            <button type="button" onClick={() => onReply("reply")} className={menuItem}>
              <Reply className="size-4" /> Reply
            </button>
            {hasReplyAll(m, own) ? (
              <button type="button" onClick={() => onReply("reply_all")} className={menuItem}>
                <ReplyAll className="size-4" /> Reply all
              </button>
            ) : null}
            <button type="button" onClick={() => onReply("forward")} className={menuItem}>
              <Forward className="size-4" /> Forward
            </button>
          </Dropdown>
        </div>
      </header>

      <div className="mt-3 md:pl-11">
        {m.remoteImages > 0 ? (
          <p className="mb-2 flex items-center gap-1.5 text-[13px] text-muted md:text-xs">
            <ImageOff className="size-3.5" /> Remote images hidden ({m.remoteImages}) — they could track when you read this.
          </p>
        ) : null}
        {m.srcDoc ? (
          <div className="dark:rounded-lg dark:bg-white dark:p-3">
            <EmailFrame srcDoc={m.srcDoc} title={`Email from ${senderName}`} />
          </div>
        ) : body ? (
          <div className="prose-plain text-[17px] leading-relaxed text-fg md:text-sm">{body.replace(/\s+$/, "")}</div>
        ) : (
          <p className="text-[15px] italic text-muted md:text-sm">{m.snippet || "(no text)"}</p>
        )}
        {hasQuoted && !m.srcDoc ? (
          <button
            type="button"
            onClick={() => setQuoted((v) => !v)}
            aria-expanded={quoted}
            title={quoted ? "Hide quoted text" : "Show quoted text"}
            className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] text-muted hover:text-fg md:h-7 md:px-2.5 md:text-xs"
          >
            <span className="font-semibold tracking-widest">•••</span>
            {quoted ? "Hide quoted text" : "Show quoted text"}
          </button>
        ) : null}

        {m.attachments.length ? (
          <div className="mt-4">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] text-muted md:text-xs">
              <Paperclip className="size-3.5" />
              {m.attachments.length} attachment{m.attachments.length === 1 ? "" : "s"}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {m.attachments.map((a) => {
                const inner = (
                  <>
                    <FileText className="size-5 shrink-0 text-subtle" strokeWidth={1.5} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-fg md:text-sm">{a.filename}</span>
                      <span className="block text-[13px] text-muted md:text-xs">
                        {formatBytes(a.size) || a.mimeType}
                        {a.partId ? null : " · open in Gmail to download"}
                      </span>
                    </span>
                    {a.partId ? <Download className="size-4 shrink-0 text-muted" /> : null}
                  </>
                );
                return (
                  <li key={`${a.partId ?? ""}${a.filename}`}>
                    {a.partId ? (
                      <a
                        href={`/api/mail/attachment?${new URLSearchParams({ account: thread.accountId, message: m.id, part: a.partId })}`}
                        download={a.filename}
                        className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 hover:bg-surface-2 md:min-h-0 md:rounded-lg"
                      >
                        {inner}
                      </a>
                    ) : (
                      <a href={thread.gmailUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 hover:bg-surface-2 md:min-h-0 md:rounded-lg">
                        {inner}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-right text-subtle">{label}:</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </>
  );
}

function MessageAvatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-medium text-muted md:size-8 md:text-xs">
      {initials(name)}
    </span>
  );
}

function LabelChip({ children, color }: { children: React.ReactNode; color?: string | null }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md bg-surface-2 px-2 text-[13px] text-muted md:h-5 md:px-1.5 md:text-[11px] md:font-medium">
      {color ? <span className="size-2 rounded-full" style={{ backgroundColor: color }} /> : null}
      {children}
    </span>
  );
}

function ReplyButton({ onClick, icon: Icon, children }: { onClick: () => void; icon: typeof Reply; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl border border-border bg-surface text-[13px] font-medium text-fg active:bg-surface-2 md:h-9 md:flex-row md:gap-2 md:rounded-full md:px-5 md:text-sm md:hover:bg-surface-2"
    >
      <Icon className="size-5 md:size-4" strokeWidth={1.75} />
      {children}
    </button>
  );
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}

function ToolLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link href={href} aria-label={label} title={label} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
      {children}
    </Link>
  );
}

function BarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-11 items-center justify-center rounded-full text-blue-600 active:opacity-50 dark:text-blue-400 [&_svg]:stroke-[1.75]"
    >
      {children}
    </button>
  );
}
