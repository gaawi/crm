import { assistantApiGuard } from "@/lib/assistant/auth";
import { applyContactPhotos, ContactPhotosError } from "@/lib/assistant/contact-photos";

/**
 * Contact photos found by Claude. Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * POST /api/assistant-agent/contact-photos
 *      {"photos": [{"contactId"? | "email"?, "url": "https://…/face.jpg", "source": "https://…/team"}]}
 *      sets each contact's photo (url: an https image; source: the https page
 *      it was found on). 1–100 items, each succeeds or fails on its own:
 *      {"ok": true, "updated": n, "failed": n, "results": [{"index", "ok", "contactId", "photoUrl"} | {"index", "ok": false, "error"}]}.
 *      GET /api/assistant-agent/contacts?projectId=<uuid> lists a campaign's people.
 */

export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  try {
    return Response.json(await applyContactPhotos(body), { headers: noStore });
  } catch (error) {
    if (error instanceof ContactPhotosError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant contact photos failed:", error);
    return Response.json({ error: "Could not save the photos." }, { status: 500 });
  }
}
