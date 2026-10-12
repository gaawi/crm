import { assistantApiGuard } from "@/lib/assistant/auth";
import { applyRun, RunsError } from "@/lib/assistant/runs";
import { runHeader } from "@/lib/assistant/write-route";

/**
 * The daily routine's run log. Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * POST /api/assistant-agent/runs
 *      {"action": "start", "agent"?: "writer" | "prospector", "model"?} → {"ok": true, "runId"}  (first call of every run)
 *      {"action": "finish", "runId"?, "report"} → {"ok": true, "runId"}  (last call: the report for the owner)
 * Every write made between start and finish (proposals, contacts, profiles,
 * contact-photos, rows) is recorded with the run, request and response; send
 * "X-Assistant-Run: <runId>" on every call so overlapping runs never mix.
 */

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
    return Response.json(await applyRun(body, runHeader(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RunsError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant run log failed:", error);
    return Response.json({ error: "Could not record the run." }, { status: 500 });
  }
}
