import "server-only";
import { accountDot } from "@/lib/mail/format";
import { userLabels, type UserLabel } from "@/lib/mail/gmail";
import { getMailCounts, unreadLabelCountsByAccount, type MailCounts } from "@/lib/mail/queries";
import type { MailListState } from "@/lib/mail/params";
import { listAccounts } from "@/lib/sync/accounts";
import type { AccountStatus } from "@/lib/types";

/** Everything the mail sidebar / Mailboxes sheet needs, safe to pass to the client. */
export interface MailAccountInfo {
  id: string;
  email: string;
  displayName: string | null;
  status: AccountStatus;
  dot: string;
  /** Unread Primary threads. */
  unread: number;
  /** Has Google tokens (demo or disconnected accounts do not): only then is Gmail called live. */
  live: boolean;
}

export interface MailLabelInfo extends UserLabel {
  unread: number;
  dot: string;
}

export interface MailChrome {
  accounts: MailAccountInfo[];
  /** Counts for the current account filter (tabs, Inbox). */
  counts: MailCounts;
  /** Primary unread across all accounts. */
  totalUnread: number;
  /** User labels of the accounts in scope. */
  labels: MailLabelInfo[];
  /** The account filter, if it names a known account. */
  account: MailAccountInfo | null;
}

export async function loadMailChrome(state: Pick<MailListState, "account">): Promise<MailChrome> {
  const records = (await listAccounts()).filter((a) => a.status !== "disconnected");
  const account = records.find((a) => a.id === state.account) ?? null;
  const liveIds = records.filter((a) => a.status === "active" && a.refreshTokenEnc).map((a) => a.id);
  const scopeIds = account ? liveIds.filter((id) => id === account.id) : liveIds;
  const [all, filtered, labelCounts, labels] = await Promise.all([
    getMailCounts(),
    account ? getMailCounts(account.id) : null,
    unreadLabelCountsByAccount(),
    userLabels(scopeIds),
  ]);
  const dots = new Map(records.map((a, i) => [a.id, accountDot(i)]));
  const accounts: MailAccountInfo[] = records.map((a) => ({
    id: a.id,
    email: a.email,
    displayName: a.displayName,
    status: a.status,
    dot: dots.get(a.id) ?? accountDot(0),
    unread: all.byAccount[a.id] ?? 0,
    live: liveIds.includes(a.id),
  }));
  return {
    accounts,
    counts: filtered ?? all,
    totalUnread: all.inbox.primary,
    labels: labels.map((l) => ({ ...l, unread: labelCounts[l.accountId]?.[l.id] ?? 0, dot: dots.get(l.accountId) ?? accountDot(0) })),
    account: accounts.find((a) => a.id === account?.id) ?? null,
  };
}

/** `label:` search terms → label ids (user labels by name, else the system label). */
export function labelResolver(labels: UserLabel[]): (name: string) => string[] {
  return (name) => {
    const wanted = name.trim().toLowerCase();
    const ids = labels.filter((l) => l.name.toLowerCase() === wanted || l.id.toLowerCase() === wanted).map((l) => l.id);
    if (ids.length) return [...new Set(ids)];
    return [name.toUpperCase().replace(/[\s-]+/g, "_")];
  };
}

/** Request time for date labels ("3:04 PM" vs "Sep 3"), passed down so server and client agree. */
export function requestTime(): number {
  return Date.now();
}
