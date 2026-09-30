/**
 * URL state of the mail client (client- and server-safe). The list lives at
 * /mail?view=&tab=&account=&label=&q=&cursor=&trail= and a thread at
 * /mail/t/[accountId]/[threadId] with the same query, so "back" returns to
 * the same list page.
 */

export const MAIL_VIEWS = ["inbox", "starred", "important", "sent", "drafts", "all", "trash", "label"] as const;
export type MailViewParam = (typeof MAIL_VIEWS)[number];

export const INBOX_TABS = ["primary", "promotions", "social", "updates", "forums"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const TAB_TITLES: Record<InboxTab, string> = {
  primary: "Primary",
  promotions: "Promotions",
  social: "Social",
  updates: "Updates",
  forums: "Forums",
};

export const VIEW_TITLES: Record<MailViewParam, string> = {
  inbox: "Inbox",
  starred: "Starred",
  important: "Important",
  sent: "Sent",
  drafts: "Drafts",
  all: "All mail",
  trash: "Trash",
  label: "Label",
};

export interface MailListState {
  view: MailViewParam;
  tab: InboxTab;
  account: string | null;
  label: string | null;
  q: string;
  cursor: string | null;
  /** Cursors of the previous pages (for "newer"), oldest first. */
  trail: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GMAIL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,400}$/;
const MAX_TRAIL = 20;

type SearchParams = Record<string, string | string[] | undefined>;

function first(sp: SearchParams, key: string): string {
  const value = sp[key];
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

export const isAccountId = (value: string | null | undefined): value is string => Boolean(value && UUID.test(value));
export const isGmailId = (value: string | null | undefined): value is string => Boolean(value && GMAIL_ID.test(value));

export function parseMailParams(sp: SearchParams): MailListState {
  const view = first(sp, "view") as MailViewParam;
  const tab = first(sp, "tab") as InboxTab;
  const account = first(sp, "account");
  const label = first(sp, "label");
  const cursor = first(sp, "cursor");
  const parsedView = MAIL_VIEWS.includes(view) ? view : "inbox";
  const parsedLabel = isGmailId(label) ? label : null;
  return {
    view: parsedView === "label" && !parsedLabel ? "inbox" : parsedView,
    tab: INBOX_TABS.includes(tab) ? tab : "primary",
    account: isAccountId(account) ? account.toLowerCase() : null,
    label: parsedLabel,
    q: first(sp, "q").slice(0, 500),
    cursor: CURSOR.test(cursor) ? cursor : null,
    trail: first(sp, "trail")
      .split(".")
      .filter((c) => CURSOR.test(c))
      .slice(-MAX_TRAIL),
  };
}

/** Query-string pairs for a list state (defaults left out). */
export function listQuery(state: Partial<MailListState>): [string, string][] {
  const out: [string, string][] = [];
  const view = state.view ?? "inbox";
  if (state.q) out.push(["q", state.q]);
  else {
    if (view !== "inbox") out.push(["view", view]);
    if (view === "inbox" && state.tab && state.tab !== "primary") out.push(["tab", state.tab]);
    if (view === "label" && state.label) out.push(["label", state.label]);
  }
  if (state.account) out.push(["account", state.account]);
  if (state.cursor) out.push(["cursor", state.cursor]);
  if (state.cursor && state.trail?.length) out.push(["trail", state.trail.slice(-MAX_TRAIL).join(".")]);
  return out;
}

function withQuery(path: string, pairs: [string, string][]): string {
  if (!pairs.length) return path;
  return `${path}?${new URLSearchParams(pairs).toString()}`;
}

export function mailListHref(state: Partial<MailListState>): string {
  return withQuery("/mail", listQuery(state));
}

/** A view of the current list state (keeps the account, drops search and paging). */
export function mailViewHref(current: Pick<MailListState, "account">, next: Partial<MailListState>): string {
  return mailListHref({ account: current.account, ...next });
}

export function threadHref(accountId: string, threadId: string, list: Partial<MailListState>): string {
  return withQuery(`/mail/t/${encodeURIComponent(accountId)}/${encodeURIComponent(threadId)}`, listQuery(list));
}

/** Next page: the current cursor joins the trail. */
export function nextPageHref(state: MailListState, next: string): string {
  const trail = state.cursor ? [...state.trail, state.cursor] : [];
  return mailListHref({ ...state, cursor: next, trail });
}

/** Previous page, or null on the first page. */
export function prevPageHref(state: MailListState): string | null {
  if (!state.cursor) return null;
  const trail = [...state.trail];
  const cursor = trail.pop() ?? null;
  return mailListHref({ ...state, cursor, trail });
}

/** 1-based index of the first row on this page. */
export function pageStart(state: MailListState, pageSize: number): number {
  return state.cursor ? (state.trail.length + 1) * pageSize + 1 : 1;
}

/** Big title of a list ("All Inboxes" for the unified inbox, like iPhone Mail). */
export function listTitle(state: MailListState, labelName?: string | null): string {
  if (state.q) return "Search";
  if (state.view === "inbox") {
    if (state.tab !== "primary") return TAB_TITLES[state.tab];
    return state.account ? "Inbox" : "All Inboxes";
  }
  if (state.view === "label") return labelName ?? "Label";
  return VIEW_TITLES[state.view];
}
