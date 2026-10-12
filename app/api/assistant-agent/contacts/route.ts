import { assistantApiGuard } from "@/lib/assistant/auth";
import { assistantWrite } from "@/lib/assistant/write-route";
import { applyContactCards, ContactCardsError } from "@/lib/assistant/contact-cards";
import { ContactPhotosError, listContactsForProject } from "@/lib/assistant/contact-photos";

/**
 * A campaign's people: Claude fills their contact cards before it writes to them.
 * Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET /api/assistant-agent/contacts?projectId=<uuid>[&missingPhoto=1][&unresearched=1]
 *     {"projectId", "projectName", "count", "contacts": [{"id", "name", "displayName", "role", "emails",
 *      "organization": {"id", "name", "website"} | null, "organizationHasProfile", "phone", "whatsapp", "notes",
 *      "photoUrl", "photoSource", "researchedAt", "researchSources", "cardMissing": ["role", "phone", …], "opportunityIds"}]}
 *     The rows' contacts plus people added to the project; archived contacts
 *     are left out. missingPhoto=1: only those without a photo;
 *     unresearched=1: only cards never filled.
 *
 * POST /api/assistant-agent/contacts
 *     {"contacts": [{"contactId" | "email", "name"?, "role"?, "organization"?, "phone"?, "whatsapp"?, "notes"?,
 *       "sources": ["https://…"]}]}   (1–50 items)
 *     Fills only empty fields (the owner's data is never replaced; notes are
 *     added under theirs) and marks the card researched. Every fact needs the
 *     official or professional page it came from; an item with no fields
 *     (nothing found) still marks the card researched. The photo goes to
 *     /contact-photos, the organization's profile to /profiles.
 *     → {"ok": true, "updated", "failed", "results": [{"index", "ok", "contactId", "filled", "kept"} | {"index", "ok": false, "error"}]}
 */

const noStore = { "Cache-Control": "no-store" };
const yes = (v: string | null) => ["1", "true", "yes"].includes(v ?? "");

export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  try {
    return Response.json(await listContactsForProject(params.get("projectId"), yes(params.get("missingPhoto")), yes(params.get("unresearched"))), {
      headers: noStore,
    });
  } catch (error) {
    if (error instanceof ContactPhotosError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant contacts list failed:", error);
    return Response.json({ error: "Could not list the contacts." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return assistantWrite(
    request,
    "contacts",
    applyContactCards,
    (e): e is ContactCardsError => e instanceof ContactCardsError,
    "Could not save the contact cards.",
  );
}
