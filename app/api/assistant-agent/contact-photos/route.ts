import { assistantWrite } from "@/lib/assistant/write-route";
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

export async function POST(request: Request) {
  return assistantWrite(
    request,
    "contact-photos",
    applyContactPhotos,
    (e): e is ContactPhotosError => e instanceof ContactPhotosError,
    "Could not save the photos.",
  );
}
