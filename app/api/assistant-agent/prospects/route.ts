import { assistantApiGuard } from "@/lib/assistant/auth";
import { listProspects, ProspectsError } from "@/lib/assistant/prospects";

/**
 * People we have written to (any of our mailboxes) who are not yet rows of the
 * campaign: where the prospector looks first. Read-only.
 * Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET /api/assistant-agent/prospects?projectId=<uuid>[&q=chamber series][&since=YYYY-MM-DD][&limit=50][&offset=0]
 *     {"projectId", "count", "prospects": [{"email", "name", "contactId", "organization", "otherCampaigns",
 *      "sentCount", "bulkCount", "receivedCount", "firstSent", "lastSent", "lastReceived", "lastSubject", "mailboxes"}]}
 *     q searches the subject and text of our emails to them. Newest first.
 */

export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  try {
    return Response.json(await listProspects(new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProspectsError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant prospects failed:", error);
    return Response.json({ error: "Could not list the prospects." }, { status: 500 });
  }
}
