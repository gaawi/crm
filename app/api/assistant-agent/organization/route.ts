import { assistantApiGuard } from "@/lib/assistant/auth";
import { organizationDossier } from "@/lib/assistant/organization";

/**
 * One organization for research. Authorization: Bearer <ASSISTANT_API_TOKEN>.
 *
 * GET /api/assistant-agent/organization?id=<uuid>
 *     {"organization": {id, name, kind, city, website, domains, tags, notes, profile},
 *      "people": [{id, name, role, phone, notes, status, photoUrl, photoSource, researchedAt, researchSources, lastOutboundAt, lastInboundAt, emails}],
 *      "rows": [{id, project, section, stage, title, notes, nextStep, followUpAt, contact}]}
 */
export async function GET(request: Request) {
  const denied = await assistantApiGuard(request);
  if (denied) return denied;
  const dossier = await organizationDossier(new URL(request.url).searchParams.get("id"));
  if (!dossier) return Response.json({ error: "Pass ?id=<organization uuid> of an existing organization." }, { status: 404 });
  return Response.json(dossier, { headers: { "Cache-Control": "no-store" } });
}
