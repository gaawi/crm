import { assistantApiGuard } from "@/lib/assistant/auth";
import { applyListings, listingsOverview, ListingsError } from "@/lib/assistant/listings";
import { assistantWrite } from "@/lib/assistant/write-route";

/**
 * Promotion: the partners and outlets each concert is sent to. Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET  /api/assistant-agent/promotion[?event=<uuid>]
 *      {"events": [{id, title, startsAt, timeZone, venue, counts}], "event": {...} | null,
 *       "platforms": [{id, name, website, submitUrl, email, method, loginRequired, loginAccount,
 *                      cost, costNote, leadDays, audience, instructions, notes, active, submission}]}
 * POST /api/assistant-agent/promotion
 *      {"events"?: [{id?, title, date: "YYYY-MM-DD", time: "HH:MM", timeZone?, venue?, address?,
 *                    ticketUrl?, infoUrl?, imageUrl?, prices?, description?, notes?}],
 *       "platforms"?: [{name, kind?: partner|editorial|calendar|newsletter|aggregator|other,
 *                       tier?: always|sometimes|skip, website?, submitUrl?, email?, method?: form|email|account|other,
 *                       loginRequired?, loginAccount?, cost?: free|paid|unknown, costNote?, leadDays?,
 *                       audience?, fields?, instructions?, notes?}],          (matched by name)
 *       "submissions"?: [{event: id|title, platform: id|name, status?: todo|sent|received|published|
 *                         rejected|blocked|skipped, sentAt?, sentBy?, confirmationUrl?, publicUrl?, notes?}]}
 *      Only the fields sent change. Never a password: loginAccount names the account.
 */

export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  try {
    const result = await listingsOverview(new URL(request.url).searchParams.get("event"));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ListingsError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request) {
  return assistantWrite(request, "promotion", applyListings, (e): e is ListingsError => e instanceof ListingsError, "Could not save the listings.");
}
