import { after } from "next/server";
import { assertSession, UnauthorizedError } from "@/lib/auth";
import { fetchThreadCached } from "@/lib/mail/gmail";
import { isAccountId, isGmailId } from "@/lib/mail/params";

/**
 * POST /api/mail/warm {accountId, threadId}: start fetching a conversation
 * from Gmail before it is opened (the pointer is on it), so the thread page
 * finds it in the recent-threads cache. Read-only; answers at once.
 */
export async function POST(request: Request) {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response(null, { status: 401 });
    throw error;
  }
  const body = (await request.json().catch(() => null)) as {
    accountId?: unknown;
    threadId?: unknown;
  } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId.toLowerCase() : "";
  const threadId = typeof body?.threadId === "string" ? body.threadId : "";
  if (!isAccountId(accountId) || !isGmailId(threadId)) return new Response(null, { status: 400 });
  after(() =>
    fetchThreadCached(accountId, threadId).then(
      () => undefined,
      () => undefined,
    ),
  );
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
