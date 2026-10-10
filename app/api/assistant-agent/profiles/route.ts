import { assistantApiGuard } from "@/lib/assistant/auth";
import { applyProfiles, listProfilesForProject, ProfilesError } from "@/lib/assistant/profiles";

/**
 * Organization profiles researched by Claude. Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET  /api/assistant-agent/profiles?projectId=<uuid>[&missing=1]
 *      the sheet's organizations with id, name, website, contact emails and
 *      current profile (missing=1: only those without one).
 * POST /api/assistant-agent/profiles
 *      {"profiles": [{"organizationId"? | "opportunityId"? | "contactEmail"?, "profile": {…}}]}
 *      replaces each organization's profile; per-item results. Profile shape:
 *      lib/organizations/profile.ts (summary required). Optional "tagline"
 *      (≤120 chars) is the one-line summary lists show, e.g. "Chamber music
 *      festival" (a trailing " · Kuopio, Finland" is fine); "city" (≤80) and
 *      "country" (≤60) are shown as "Kuopio, Finland", linked to Google Maps
 *      (else "location", else the organization's city); "address" (≤200)
 *      and each venue's name (or its own "address", ≤200) link to Maps too.
 */

export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  try {
    const missing = ["1", "true", "yes"].includes(params.get("missing") ?? "");
    return Response.json(await listProfilesForProject(params.get("projectId"), missing), { headers: noStore });
  } catch (error) {
    if (error instanceof ProfilesError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant profiles list failed:", error);
    return Response.json({ error: "Could not list the organizations." }, { status: 500 });
  }
}

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
    return Response.json(await applyProfiles(body), { headers: noStore });
  } catch (error) {
    if (error instanceof ProfilesError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant profiles failed:", error);
    return Response.json({ error: "Could not save the profiles." }, { status: 500 });
  }
}
