import { ExternalLink } from "lucide-react";
import { ComposeFab } from "@/components/mail/compose-button";
import { DesktopSearch, PhoneMailHeader } from "@/components/mail/mail-header";
import { MailSidebar } from "@/components/mail/mail-sidebar";
import { buildMailboxes } from "@/components/mail/mailboxes";
import { ThreadList, type LabelInfo, type TabInfo } from "@/components/mail/thread-list";
import { Notice } from "@/components/ui/layout";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatListDate } from "@/lib/mail/format";
import { listThreads, PAGE_SIZE } from "@/lib/mail/queries";
import {
  INBOX_TABS,
  TAB_TITLES,
  listTitle,
  mailListHref,
  nextPageHref,
  pageStart,
  parseMailParams,
  prevPageHref,
  type MailListState,
} from "@/lib/mail/params";
import { gmailDraftUrl, listGmailDrafts } from "@/lib/sync/drafts";
import { cn, errorMessage } from "@/lib/utils";
import { labelResolver, loadMailChrome, requestTime, type MailAccountInfo } from "./_lib/chrome";

const EMPTY: Record<string, [string, string]> = {
  inbox: ["Nothing here", "Your inbox is clear."],
  starred: ["No starred conversations", "Star a conversation to find it here."],
  important: ["No important conversations", "Gmail marks conversations as important for you."],
  sent: ["Nothing sent yet", "Messages you send appear here."],
  all: ["No conversations", "Nothing has been synced for this account yet."],
  trash: ["Trash is empty", "Conversations you delete stay here for 30 days in Gmail."],
  label: ["No conversations", "Nothing has this label."],
};

export default async function MailPage({ searchParams }: PageProps<"/mail">) {
  await requireSession();
  const parsed = parseMailParams(await searchParams);
  const chrome = await loadMailChrome(parsed);
  const state: MailListState = { ...parsed, account: chrome.account?.id ?? null };
  const groups = buildMailboxes(chrome, state);
  const now = requestTime();
  const label = state.view === "label" ? chrome.labels.find((l) => l.id === state.label && (!state.account || l.accountId === state.account)) : null;
  const title = listTitle(state, label?.name);
  const clearHref = mailListHref({ account: state.account });
  const subtitle = state.q ? `“${state.q}”` : chrome.account && state.view === "inbox" ? chrome.account.email : null;

  const drafts = state.view === "drafts" && !state.q;
  const [page, draftList] = await Promise.all([
    drafts
      ? null
      : listThreads({
          view: state.view === "drafts" ? "inbox" : state.view,
          category: state.tab,
          labelId: state.label,
          accountId: state.account,
          q: state.q || null,
          cursor: state.cursor,
          resolveLabel: labelResolver(chrome.labels),
        }),
    drafts ? loadDrafts(chrome.account ? [chrome.account] : chrome.accounts) : null,
  ]);

  const tabs: TabInfo[] | null =
    state.view === "inbox" && !state.q
      ? INBOX_TABS.map((tab) => ({
          tab,
          label: TAB_TITLES[tab],
          unread: chrome.counts.inbox[tab],
          href: mailListHref({ view: "inbox", tab, account: state.account }),
          active: state.tab === tab,
        }))
      : null;
  const labels: Record<string, LabelInfo> = Object.fromEntries(chrome.labels.map((l) => [`${l.accountId}:${l.id}`, { name: l.name, color: l.color }]));
  const accountDots = Object.fromEntries(chrome.accounts.map((a) => [a.id, a.dot]));
  const [emptyTitle, emptyText] = state.q ? ["No results", `Nothing matches “${state.q}”.`] : (EMPTY[state.view] ?? EMPTY.all);

  return (
    <div className="md:flex md:h-dvh">
      <MailSidebar groups={groups} variant="list" account={state.account} />
      <section className="flex min-w-0 flex-1 flex-col pb-[calc(env(safe-area-inset-bottom)+6rem)] md:pb-0" aria-label={title}>
        <PhoneMailHeader title={title} subtitle={subtitle} groups={groups} q={state.q} account={state.account} clearHref={clearHref} />
        <div className="hidden h-16 shrink-0 items-center gap-4 border-b border-border bg-surface px-4 md:flex">
          <DesktopSearch q={state.q} account={state.account} clearHref={clearHref} />
          {chrome.account ? <span className="ml-auto hidden truncate text-xs text-muted xl:inline">{chrome.account.email}</span> : null}
        </div>

        {chrome.accounts.length === 0 ? (
          <div className="p-4 md:p-6">
            <Notice>Connect a Gmail account in Settings to see your mail here.</Notice>
          </div>
        ) : null}

        {draftList ? (
          <DraftsList drafts={draftList} now={now} showAccount={!state.account && chrome.accounts.length > 1} />
        ) : page ? (
          <ThreadList
            threads={page.threads}
            state={state}
            now={now}
            range={{
              start: pageStart(state, PAGE_SIZE),
              end: pageStart(state, PAGE_SIZE) + page.threads.length - 1,
              prevHref: prevPageHref(state),
              nextHref: page.next ? nextPageHref(state, page.next) : null,
            }}
            tabs={tabs}
            accountDots={accountDots}
            showAccount={!state.account && chrome.accounts.length > 1}
            labels={labels}
            emptyTitle={emptyTitle}
            emptyText={emptyText}
          />
        ) : null}
      </section>
      <ComposeFab account={state.account} />
    </div>
  );
}

interface DraftRow {
  draftId: string;
  accountEmail: string;
  dot: string;
  to: string[];
  subject: string;
  snippet: string;
  updatedAt: Date | null;
  url: string;
}

/** Gmail drafts, live per account (editing them happens in Gmail). */
async function loadDrafts(accounts: MailAccountInfo[]): Promise<{ rows: DraftRow[]; errors: string[] }> {
  const errors: string[] = [];
  const lists = await Promise.all(
    accounts.map(async (a) => {
      if (!a.live) {
        errors.push(`${a.email}: Gmail is not connected, so its drafts can't be listed.`);
        return [];
      }
      try {
        return (await listGmailDrafts(a.id, { limit: 50 })).map((d) => ({
          draftId: d.draftId,
          accountEmail: a.email,
          dot: a.dot,
          to: d.to,
          subject: d.subject,
          snippet: d.snippet,
          updatedAt: d.updatedAt,
          url: gmailDraftUrl(a.email, d.gmailMessageId),
        }));
      } catch (error) {
        errors.push(`${a.email}: ${errorMessage(error)}`);
        return [];
      }
    }),
  );
  const rows = lists.flat().sort((x, y) => (y.updatedAt?.getTime() ?? 0) - (x.updatedAt?.getTime() ?? 0));
  return { rows, errors };
}

function DraftsList({ drafts, now, showAccount }: { drafts: { rows: DraftRow[]; errors: string[] }; now: number; showAccount: boolean }) {
  const timezone = env.timezone;
  return (
    <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
      <p className="border-b border-border px-4 py-2 text-[13px] text-muted md:text-xs">Drafts open in Gmail, in the right account.</p>
      {drafts.errors.map((e) => (
        <div key={e} className="px-4 pt-3">
          <Notice tone="warning">{e}</Notice>
        </div>
      ))}
      {!drafts.rows.length ? (
        <div className="flex flex-col items-center gap-1 px-6 py-16 text-center">
          <p className="text-[17px] font-medium md:text-sm">No drafts</p>
          <p className="text-[15px] text-muted md:text-sm">Drafts you save in Gmail appear here.</p>
        </div>
      ) : (
        <ul>
          {drafts.rows.map((d) => (
            <li key={d.draftId} className="border-b border-border bg-surface">
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[64px] flex-col justify-center gap-0.5 px-4 py-2.5 active:bg-surface-2 md:h-10 md:min-h-0 md:flex-row md:items-center md:gap-3 md:py-0 md:hover:bg-surface-2"
              >
                <span className="flex items-center gap-2 md:w-52 md:shrink-0">
                  <span className="text-[15px] font-semibold text-red-600 md:text-sm dark:text-red-400">Draft</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] md:text-sm">{d.to.join(", ") || "(no recipients)"}</span>
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] md:text-sm">
                  {d.subject || "(no subject)"}
                  {d.snippet ? <span className="text-muted"> — {d.snippet}</span> : null}
                </span>
                <span className="flex items-center gap-2 text-[13px] text-muted md:text-xs">
                  {showAccount ? <span className={cn("size-2 rounded-full", d.dot)} title={d.accountEmail} /> : null}
                  {d.updatedAt ? formatListDate(d.updatedAt, timezone, new Date(now)) : null}
                  <ExternalLink className="size-3.5" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
