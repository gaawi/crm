import "server-only";
import type { ThreadMessageView, ThreadViewData } from "@/components/mail/thread-types";
import type { MailAccountInfo } from "@/app/(app)/mail/_lib/chrome";
import { storedThreadLabels } from "@/lib/mail/queries";
import { getThread } from "@/lib/queries/messages";
import { gmailThreadUrl } from "@/lib/utils";

const HIDDEN = ["DELETED", "SPAM", "DRAFT", "CHAT"];

/** The copy stored by sync (plain text, quotes stripped) when Gmail can't be reached. */
export async function storedThreadView(account: Pick<MailAccountInfo, "id" | "email">, threadId: string): Promise<ThreadViewData | null> {
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

