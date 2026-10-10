import { assistantApiGuard } from "@/lib/assistant/auth";
import { applyProposals, ProposalError } from "@/lib/assistant/proposals";

/**
 * POST /api/assistant-agent/proposals — the daily campaign assistant writes
 * back emails (proposals waiting for the owner's approval, never sent here),
 * recommended actions and new versions of emails the owner asked to change.
 * Authorization: Bearer <ASSISTANT_API_TOKEN>.
 */

export const maxDuration = 120;

export async function POST(request: Request) {
  const denied = assistantApiGuard(request);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  try {
    return Response.json(await applyProposals(body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProposalError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Assistant proposals failed:", error);
    return Response.json({ error: "Could not save the proposals." }, { status: 500 });
  }
}
