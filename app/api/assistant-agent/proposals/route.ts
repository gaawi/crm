import { assistantWrite } from "@/lib/assistant/write-route";
import { applyProposals, ProposalError } from "@/lib/assistant/proposals";

/**
 * POST /api/assistant-agent/proposals — the daily campaign assistant writes
 * back emails (proposals waiting for the owner's approval, never sent here),
 * recommended actions and new versions of emails the owner asked to change.
 * Authorization: Bearer <ASSISTANT_API_TOKEN>.
 */

export const maxDuration = 120;

export async function POST(request: Request) {
  return assistantWrite(request, "proposals", applyProposals, (e): e is ProposalError => e instanceof ProposalError, "Could not save the proposals.");
}
