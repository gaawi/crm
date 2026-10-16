import { assertSession, UnauthorizedError } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getMailCounts } from "@/lib/mail/queries";

/**
 * GET /api/mail/state: a small fingerprint of the mailboxes (newest stored
 * email, unread counts). The open Mail list polls it and re-reads the page
 * only when it changes, instead of re-rendering everything every minute.
 */
export async function GET() {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response(null, { status: 401 });
    throw error;
  }
  const [[newest], counts] = await Promise.all([sql<{ at: Date | null }[]>`select max(sent_at) as at from messages`, getMailCounts()]);
  const stamp = [newest?.at?.getTime() ?? 0, ...Object.values(counts.inbox), ...Object.values(counts.labels)].join(":");
  return Response.json({ stamp }, { headers: { "Cache-Control": "no-store" } });
}
