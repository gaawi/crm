import { assistantApiGuard } from "@/lib/assistant/auth";
import { ContactPhotosError, listContactsForProject } from "@/lib/assistant/contact-photos";

/**
 * A campaign's people, so Claude can research them (photos, roles…).
 * Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET /api/assistant-agent/contacts?projectId=<uuid>[&missingPhoto=1]
 *     {"projectId", "projectName", "count", "contacts": [{"id", "name", "displayName", "role", "emails",
 *      "organization": {"id", "name", "website"} | null, "photoUrl", "photoSource", "opportunityIds"}]}
 *     The rows' contacts plus people added to the project; archived contacts
 *     are left out. missingPhoto=1: only those without a photo.
 */

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  try {
    const missing = ["1", "true", "yes"].includes(params.get("missingPhoto") ?? "");
    return Response.json(await listContactsForProject(params.get("projectId"), missing), { headers: noStore });
  } catch (error) {
    if (error instanceof ContactPhotosError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant contacts list failed:", error);
    return Response.json({ error: "Could not list the contacts." }, { status: 500 });
  }
}
