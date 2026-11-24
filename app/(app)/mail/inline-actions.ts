"use server";

import type { ThreadViewData } from "@/components/mail/thread-types";
import { requireSession } from "@/lib/auth";
import { isAccountId, isGmailId } from "@/lib/mail/params";
import { storedThreadView } from "@/lib/mail/stored-thread";
import { newPart } from "@/lib/queries/last-reply";
import { listAccounts } from "@/lib/sync/accounts";

/**
 * One conversation for reading in place (a campaign row's panel, Today, a
 * contact): the copy stored by sync, each message cut to what is new in it.
 * Null when it can't be found.
 */
export async function inlineThreadAction(accountId: string, threadId: string): Promise<ThreadViewData | null> {
  await requireSession();
  if (!isAccountId(accountId) || !isGmailId(threadId)) return null;
  const account = (await listAccounts()).find((a) => a.id === accountId.toLowerCase());
  if (!account) return null;
  const thread = await storedThreadView({ id: account.id, email: account.email }, threadId);
  if (!thread) return null;
  return {
    ...thread,
    messages: thread.messages.map((m) => ({ ...m, textWithoutQuotes: newPart(m.text, 20_000), text: null })),
  };
}
