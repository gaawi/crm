import { applyRows, RowsError } from "@/lib/assistant/rows";
import { assistantWrite } from "@/lib/assistant/write-route";

/**
 * New prospects for a campaign, added by the prospector. Authorization: Bearer <ASSISTANT_API_TOKEN>.
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
