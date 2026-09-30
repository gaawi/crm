import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { CrmPanel } from "@/components/mail/crm-panel";
import { DesktopSearch } from "@/components/mail/mail-header";
import { MailSidebar } from "@/components/mail/mail-sidebar";
import { buildMailboxes } from "@/components/mail/mailboxes";
import { composeFor } from "@/components/mail/reply-init";
import type { ThreadMessageView, ThreadViewData } from "@/components/mail/thread-types";
import { ThreadView } from "@/components/mail/thread-view";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { applyThreadAction, fetchThread, userLabels, type LiveThread } from "@/lib/mail/gmail";
import { isAccountId, isGmailId, listTitle, mailListHref, parseMailParams } from "@/lib/mail/params";
import { storedThreadLabels } from "@/lib/mail/queries";
import { buildSrcDoc } from "@/lib/mail/sanitize";
import { getThread } from "@/lib/queries/messages";
import { getOwnAddresses } from "@/lib/queries/stats";
import type { Address } from "@/lib/types";
import { errorMessage, gmailThreadUrl } from "@/lib/utils";
import { loadMailChrome, requestTime, type MailAccountInfo } from "../../../_lib/chrome";

export const metadata: Metadata = { title: "Mail" };

const HIDDEN = ["DELETED", "SPAM", "DRAFT", "CHAT"];

function fromLive(live: LiveThread): ThreadViewData {
  return {
    key: `${live.accountId}:${live.threadId}`,
    accountId: live.accountId,
    accountEmail: live.accountEmail,
    threadId: live.threadId,
    subject: live.subject,
    labelIds: live.labelIds,
    gmailUrl: gmailThreadUrl(live.accountEmail, live.threadId),
    source: "live",
    messages: live.messages.map((m) => ({
      id: m.gmailMessageId,
      from: m.from,
      to: m.to,
      cc: m.cc,
      replyTo: m.replyTo,
      date: m.date,
      outbound: m.outbound,
      unread: m.unread,
      starred: m.starred,
      subject: m.subject,
      snippet: m.snippet,
      srcDoc: m.html ? buildSrcDoc(m.html) : null,
      remoteImages: m.remoteImages,
      text: m.text,
      textWithoutQuotes: m.textWithoutQuotes,
      attachments: m.attachments.map((a) => ({ ...a, partId: a.partId })),
    })),
  };
}

/** The copy stored by sync (plain text, quotes stripped) when Gmail can't be reached. */
async function fromStored(account: MailAccountInfo, threadId: string): Promise<ThreadViewData | null> {
  const [messages, labels] = await Promise.all([getThread(account.id, threadId), storedThreadLabels(account.id, threadId)]);
  const shown = messages.filter((m) => !(labels[m.gmailMessageId] ?? []).some((l) => HIDDEN.includes(l)));
  const notTrashed = shown.filter((m) => !(labels[m.gmailMessageId] ?? []).includes("TRASH"));
  const visible = notTrashed.length ? notTrashed : shown;
  if (!visible.length) return null;
  const views: ThreadMessageView[] = visible.map((m) => {
    const l = labels[m.gmailMessageId] ?? [];
    return {
      id: m.gmailMessageId,
      from: m.from,
      to: m.to,
      cc: m.cc,
      replyTo: [],
      date: m.sentAt,
      outbound: m.direction === "outbound",
      unread: l.includes("UNREAD"),
      starred: l.includes("STARRED"),
      subject: m.subject,
      snippet: m.snippet ?? "",
      srcDoc: null,
      remoteImages: 0,
      text: m.bodyText,
      textWithoutQuotes: m.bodyText,
      attachments: m.attachments.map((a) => ({ partId: null, filename: a.filename, mimeType: a.mimeType, size: a.size })),
    };
  });
  return {
    key: `${account.id}:${threadId}`,
    accountId: account.id,
    accountEmail: account.email,
    threadId,
    subject: visible.find((m) => m.subject?.trim())?.subject ?? null,
    labelIds: [...new Set(visible.flatMap((m) => labels[m.gmailMessageId] ?? []))].sort(),
    gmailUrl: gmailThreadUrl(account.email, threadId),
    source: "stored",
    messages: views,
  };
}

/** Everyone in the conversation except the owner; senders first. */
function participants(thread: ThreadViewData, own: ReadonlySet<string>): Address[] {
  const out = new Map<string, Address>();
  const add = (a: Address | null) => {
    if (!a || own.has(a.email) || out.has(a.email)) return;
    out.set(a.email, a);
  };
  const newestFirst = [...thread.messages].reverse();
  for (const m of newestFirst) if (!m.outbound) [m.from, ...m.replyTo].forEach(add);
  for (const m of newestFirst) [...m.to, ...m.cc].forEach(add);
  return [...out.values()];
}

export default async function ThreadPage({ params, searchParams }: PageProps<"/mail/t/[accountId]/[threadId]">) {
  await requireSession();
  const { accountId: rawAccount, threadId } = await params;
  if (!isAccountId(rawAccount) || !isGmailId(threadId)) notFound();
  const accountId = rawAccount.toLowerCase();
  const parsed = parseMailParams(await searchParams);
  const [chrome, own] = await Promise.all([loadMailChrome(parsed), getOwnAddresses()]);
  const state = { ...parsed, account: chrome.account?.id ?? null };
  const account = chrome.accounts.find((a) => a.id === accountId);
  if (!account) notFound();

  let thread: ThreadViewData | null = null;
  let notice: string | null = null;
  const live = account.live && account.status === "active";
  if (live) {
    try {
      const fetched = await fetchThread(accountId, threadId);
      if (fetched) thread = fromLive(fetched);
      else notice = "This conversation is no longer in Gmail. Showing the copy stored in the CRM.";
    } catch (error) {
      console.warn(`Could not load thread ${threadId} from Gmail:`, errorMessage(error));
      notice = "Gmail couldn't be reached, so this is the copy stored in the CRM (plain text, no attachments to download).";
    }
  } else {
    notice =
      account.status === "reauth_required"
        ? `Reconnect ${account.email} in Settings to see the full email. Showing the copy stored in the CRM (plain text).`
        : `${account.email} is not connected to Gmail. Showing the copy stored in the CRM (plain text).`;
  }
  if (!thread) thread = await fromStored(account, threadId);
  if (!thread) notFound();

  // Opening a thread marks it read in Gmail and in the database, after the response is sent.
  if (live && thread.messages.some((m) => m.unread)) {
    after(async () => {
      try {
        await applyThreadAction(accountId, threadId, "read");
      } catch (error) {
        console.warn(`Could not mark thread ${threadId} as read:`, errorMessage(error));
      }
    });
  }

  const labels = live ? (await userLabels([accountId])).map((l) => ({ id: l.id, name: l.name, color: l.color })) : [];
  const label = state.view === "label" ? chrome.labels.find((l) => l.id === state.label) : null;
  const backHref = mailListHref(state);
  const backLabel = listTitle(state, label?.name);
  const timezone = env.timezone;
  const latest = thread.messages[thread.messages.length - 1];
  const returnPath = `/mail/t/${accountId}/${threadId}`;

  return (
    <div className="md:flex md:h-dvh">
      <MailSidebar groups={buildMailboxes(chrome, state, { threadView: true })} variant="thread" account={state.account} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hidden h-16 shrink-0 items-center border-b border-border bg-surface px-4 md:flex">
          <DesktopSearch q="" account={state.account} clearHref={backHref} />
        </div>
        <div className="max-md:bg-surface md:min-h-0 md:flex-1 md:overflow-y-auto xl:grid xl:grid-cols-[minmax(0,1fr)_21rem] xl:overflow-hidden">
          <div className="min-w-0 bg-surface max-md:contents xl:overflow-y-auto">
            <ThreadView
              // A new message or label change (after a refresh) starts from a fresh view state.
              key={`${thread.key}:${latest?.id}:${thread.labelIds.join(",")}`}
              thread={thread}
              backHref={backHref}
              backLabel={backLabel}
              hideOnLeave={{ archive: state.view === "inbox" && !state.q, trash: state.view !== "trash" }}
              userLabels={labels}
              now={requestTime()}
              notice={notice}
            />
          </div>
          <aside className="border-t border-border bg-bg px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-6 md:px-6 md:pb-8 xl:overflow-y-auto xl:border-l xl:border-t-0 xl:px-4 xl:pt-4" aria-label="CRM">
            <CrmPanel
              participants={participants(thread, own)}
              accountId={accountId}
              threadId={threadId}
              reply={latest ? composeFor("reply", thread, latest, own, timezone) : null}
              returnPath={returnPath}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
