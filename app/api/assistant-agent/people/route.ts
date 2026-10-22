import { assistantWrite } from "@/lib/assistant/write-route";
import { applyPeople, PeopleError } from "@/lib/assistant/people";

/**
 * An organization's people, researched by Claude. Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * POST /api/assistant-agent/people
 *      {"organizationId": "<uuid>", "people": [{"name", "role"?, "email"?, "phone"?, "bio"?,
 *        "photo"?, "photoSource"?, "profileUrl"?, "linkedin"?, "sources": ["https://…"]}]}   (1–30 items)
 *      Matches each person to a contact (email, else the same name at the
 *      organization), creates the ones not in VELA, fills only empty fields
 *      and sets a photo only where there is none. Facts need the official or
 *      professional page they came from; nothing is ever guessed.
 *      → {"ok": true, "created", "updated", "failed", "results": [{"index", "ok", "contactId", "created", "filled", "photo"} | {"index", "ok": false, "error"}]}
 */

export const maxDuration = 60;

export async function POST(request: Request) {
  return assistantWrite(request, "people", applyPeople, (e): e is PeopleError => e instanceof PeopleError, "Could not save the people.");
}
