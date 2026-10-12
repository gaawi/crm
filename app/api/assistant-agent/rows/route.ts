import { assistantApiGuard } from "@/lib/assistant/auth";
import { applyRows, listRows, RowsError } from "@/lib/assistant/rows";
import { assistantWrite } from "@/lib/assistant/write-route";

/**
 * A campaign's rows for the prospector. Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET /api/assistant-agent/rows?projectId=<uuid>[&section=Listas][&withoutContact=1][&unresearched=1][&limit=50][&offset=0]
 *      {"projectId", "total", "count", "rows": [{"opportunityId", "organization", "website", "city", "section", "stage",
 *        "followUpAt", "returning", "notes" (full), "contact": {"id", "name", "email", "role", "researchedAt"} | null}]}
 *
 * POST /api/assistant-agent/rows
 *      {"projectId", "rows": [{"organization", "website"?, "city"?, "contactName"?, "email"?, "role"?, "phone"?,
 *        "source": "email_history" | "owner_list" | "research", "reason", "notes"?}]}   (1–25 rows)
 *      Each becomes a "lead" row filed under its source's section, the reason in its notes. An address or an
 *      organization (name or website domain) already in the campaign is skipped.
 *      → {"ok": true, "created", "skipped", "results": [{"index", "ok", "opportunityId", "contactId"} | {"index", "ok": false, "error"}]}
 */

export const maxDuration = 60;

export async function POST(request: Request) {
  return assistantWrite(request, "rows", applyRows, (e): e is RowsError => e instanceof RowsError, "Could not add the rows.");
}

export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  try {
    return Response.json(await listRows(new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RowsError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant rows list failed:", error);
    return Response.json({ error: "Could not list the rows." }, { status: 500 });
  }
}
