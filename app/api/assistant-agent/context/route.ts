import { assistantApiGuard } from "@/lib/assistant/auth";
import { buildAssistantContext } from "@/lib/assistant/context";

/**
 * GET /api/assistant-agent/context — the daily campaign assistant reads every
 * active campaign (booking sheet). Authorization: Bearer <ASSISTANT_API_TOKEN>.
 */

export async function GET(request: Request) {
  const denied = assistantApiGuard(request);
  if (denied) return denied;
  const context = await buildAssistantContext();
  return Response.json(context, { headers: { "Cache-Control": "no-store" } });
}
