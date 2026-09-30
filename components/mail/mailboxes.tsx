import { Bookmark, File, Inbox, Info, Mails, MessagesSquare, Send, Star, Tag, Trash2, Users, type LucideIcon } from "lucide-react";
import type { MailChrome } from "@/app/(app)/mail/_lib/chrome";
import { INBOX_TABS, TAB_TITLES, mailListHref, type MailListState, type MailViewParam } from "@/lib/mail/params";

/** Sidebar / Mailboxes-sheet entries, built once on the server and rendered by both. */

export type MailboxIcon = "inbox" | "starred" | "important" | "sent" | "drafts" | "all" | "trash" | "label" | "promotions" | "social" | "updates" | "forums" | "account";

export const MAILBOX_ICONS: Record<MailboxIcon, LucideIcon> = {
  inbox: Inbox,
  starred: Star,
  important: Bookmark,
  sent: Send,
  drafts: File,
  all: Mails,
  trash: Trash2,
  label: Tag,
  promotions: Tag,
  social: Users,
  updates: Info,
  forums: MessagesSquare,
  account: Inbox,
};

export interface MailboxEntry {
  key: string;
  href: string;
  label: string;
  icon: MailboxIcon;
  count?: number;
  active: boolean;
  /** Account color dot class, or a label's own color. */
  dot?: string;
  color?: string | null;
  hint?: string;
}

export interface MailboxGroups {
  views: MailboxEntry[];
  categories: MailboxEntry[];
  accounts: MailboxEntry[];
  labels: MailboxEntry[];
}

const VIEWS: { view: Exclude<MailViewParam, "label">; label: string }[] = [
  { view: "inbox", label: "Inbox" },
  { view: "starred", label: "Starred" },
  { view: "important", label: "Important" },
  { view: "sent", label: "Sent" },
  { view: "drafts", label: "Drafts" },
  { view: "all", label: "All mail" },
  { view: "trash", label: "Trash" },
];

export function buildMailboxes(chrome: MailChrome, state: MailListState, options: { threadView?: boolean } = {}): MailboxGroups {
  const account = chrome.account?.id ?? null;
  const current = options.threadView ? null : state;
  const views = VIEWS.map(({ view, label }) => ({
    key: view,
    href: mailListHref({ view, account }),
    label,
    icon: view as MailboxIcon,
    count: view === "inbox" ? chrome.counts.inbox.primary : undefined,
    active: Boolean(current && !current.q && current.view === view) || Boolean(options.threadView && state.view === view && !state.q),
  }));
  const categories = INBOX_TABS.map((tab) => ({
    key: tab,
    href: mailListHref({ view: "inbox", tab, account }),
    label: TAB_TITLES[tab],
    icon: (tab === "primary" ? "inbox" : tab) as MailboxIcon,
    count: chrome.counts.inbox[tab],
    active: Boolean(current && !current.q && current.view === "inbox" && current.tab === tab),
  }));
  const keep = (id: string | null) => mailListHref({ view: state.view === "label" ? "inbox" : state.view, tab: state.tab, account: id });
  const accounts: MailboxEntry[] = [
    {
      key: "all-accounts",
      href: keep(null),
      label: "All inboxes",
      icon: "account",
      count: chrome.totalUnread,
      active: !account,
    },
    ...chrome.accounts.map((a) => ({
      key: a.id,
      href: keep(a.id),
      label: a.email,
      icon: "account" as const,
      count: a.unread,
      active: account === a.id,
      dot: a.dot,
      hint: a.status === "reauth_required" ? "Reconnect in Settings" : undefined,
    })),
  ];
  const labels = chrome.labels.map((l) => ({
    key: `${l.accountId}:${l.id}`,
    href: mailListHref({ view: "label", label: l.id, account: l.accountId }),
    label: l.name,
    icon: "label" as const,
    count: l.unread,
    active: Boolean(current && current.view === "label" && current.label === l.id && account === l.accountId),
    color: l.color,
    dot: chrome.accounts.length > 1 && !account ? l.dot : undefined,
  }));
  return { views, categories, accounts, labels };
}
