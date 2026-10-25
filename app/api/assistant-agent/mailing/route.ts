import { applyMailing, MailingError } from "@/lib/assistant/mailing";
import { assistantWrite } from "@/lib/assistant/write-route";

/**
 * Personalized emails as one mailing waiting for the owner's approval. Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * POST /api/assistant-agent/mailing
 *      {"projectId", "name"?: "Community Partners · Currents", "mailingId"?: <uuid to add to>,
 *       "settings"?: {perHour, dailyCap, windowStart, windowEnd, weekdaysOnly, timezone},
 *       "emails": [{"opportunityId", "subject", "body", "reason"}]}                       (1–50 per call)
 *      → {"mailingId", "created": [{opportunityId, draftId}], "skipped": [{opportunityId, reason}]}
 *      Each email goes to its row's contact, from the campaign's send account. Nothing is sent here.
 */
export async function POST(request: Request) {
  return assistantWrite(request, "mailing", applyMailing, (e): e is MailingError => e instanceof MailingError, "Could not prepare the mailing.");
}
