import { composeSubject, forwardBlock, replyQuote, replyRecipients } from "@/lib/mail/compose";
import type { ComposeInit } from "./mail-provider";
import type { ThreadMessageView, ThreadViewData } from "./thread-types";

/** Composer prefill for Reply / Reply all / Forward of one message (server- and client-safe). */
export function composeFor(
  kind: "reply" | "reply_all" | "forward",
  thread: Pick<ThreadViewData, "accountId" | "threadId" | "subject">,
  message: ThreadMessageView,
  own: ReadonlySet<string>,
  timeZone: string,
): ComposeInit {
  const source = {
    from: message.from,
    to: message.to,
    cc: message.cc,
    replyTo: message.replyTo,
    outbound: message.outbound,
    date: message.date,
    subject: message.subject ?? thread.subject,
    text: message.text ?? message.snippet,
  };
  const subject = composeSubject(kind, thread.subject ?? message.subject);
  if (kind === "forward") {
    return {
      kind,
      accountId: thread.accountId,
      threadId: thread.threadId,
      subject,
      appendix: { kind: "forward", text: forwardBlock(source, timeZone) },
    };
  }
  const { to, cc } = replyRecipients(source, kind, own);
  return {
    kind,
    accountId: thread.accountId,
    threadId: thread.threadId,
    replyToGmailMessageId: message.id,
    to,
    cc,
    subject,
    appendix: { kind: "quote", text: replyQuote(source, timeZone) },
  };
}
