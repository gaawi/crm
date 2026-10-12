import { assistantApiGuard } from "@/lib/assistant/auth";
import { HistoryError, listHistory } from "@/lib/assistant/history";

/**
 * Earlier conversations with a person or organization, newest first, from
 * all our mailboxes (Guillermo's and Josefina's included). Read-only.
 * Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET /api/assistant-agent/history?contactId=<uuid> | organizationId=<uuid> | email=<address> [&limit=40]
 *     {"count", "messages": [{"date", "direction", "mailbox", "from", "to", "recipients", "bulk", "subject", "body"}]}
 *     A mass email (bulk) lists only its recipient count. Bodies without quoted replies, up to 4000 characters.
 */

export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  try {
    return Response.json(await listHistory(new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HistoryError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant history failed:", error);
    return Response.json({ error: "Could not read the history." }, { status: 500 });
  }
}
