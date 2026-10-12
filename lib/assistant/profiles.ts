import "server-only";
import { z } from "zod";
import { orgProfileSchema, profileIssue, type OrgProfile } from "@/lib/organizations/profile";
import { listProjectOrganizations, organizationIdForEmail, organizationIdForOpportunity, setOrganizationProfile } from "@/lib/queries/org-profiles";
import { isValidEmail } from "@/lib/utils";

/**
 * Organization profiles written by Claude (POST /api/assistant-agent/profiles)
 * and the list of a sheet's organizations to research (GET). Each item names
 * its organization directly, through a sheet row (opportunity) or through a
 * contact's email address; every item succeeds or fails on its own.
 */

export const MAX_PROFILES_PER_CALL = 50;

const bodySchema = z.object({ profiles: z.array(z.unknown()).min(1).max(MAX_PROFILES_PER_CALL) });

const itemSchema = z.object({
  organizationId: z.guid().nullish(),
  opportunityId: z.guid().nullish(),
  contactEmail: z.string().trim().max(320).refine(isValidEmail, "Invalid email address.").nullish(),
  profile: z.unknown(),
});

export type ProfileItemResult =
  | { index: number; ok: true; organizationId: string }
  | { index: number; ok: false; error: string; organizationId?: string };

export interface ApplyProfilesResult {
  ok: true;
  updated: number;
  failed: number;
  results: ProfileItemResult[];
}

export class ProfilesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function resolveOrganization(item: z.output<typeof itemSchema>): Promise<{ id: string } | { error: string }> {
  if (!item.organizationId && !item.opportunityId && !item.contactEmail) {
    return { error: "Give organizationId, opportunityId or contactEmail." };
  }
  const found = new Set<string>();
  if (item.organizationId) found.add(item.organizationId.toLowerCase());
  if (item.opportunityId) {
    const id = await organizationIdForOpportunity(item.opportunityId);
    if (!id) return { error: `Opportunity ${item.opportunityId} not found or has no organization.` };
    found.add(id);
  }
  if (item.contactEmail) {
    const id = await organizationIdForEmail(item.contactEmail);
    if (!id) return { error: `No contact with an organization for ${item.contactEmail}.` };
    found.add(id);
  }
  if (found.size > 1) return { error: "organizationId, opportunityId and contactEmail point to different organizations." };
  return { id: [...found][0] };
}

export async function applyProfiles(body: unknown, now: Date = new Date()): Promise<ApplyProfilesResult> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ProfilesError(`Send {"profiles": [{organizationId | opportunityId | contactEmail, profile}]} (1–${MAX_PROFILES_PER_CALL} items).`, 400);
  }
  const results: ProfileItemResult[] = [];
  for (const [index, raw] of parsed.data.profiles.entries()) {
    const item = itemSchema.safeParse(raw);
    if (!item.success) {
      results.push({ index, ok: false, error: profileIssue(item.error) });
      continue;
    }
    const target = await resolveOrganization(item.data);
    if ("error" in target) {
      results.push({ index, ok: false, error: target.error });
      continue;
    }
    const profile = orgProfileSchema.safeParse(item.data.profile);
    if (!profile.success) {
      results.push({ index, ok: false, organizationId: target.id, error: `profile.${profileIssue(profile.error)}` });
      continue;
    }
    const value: OrgProfile = {
      ...profile.data,
      researchedBy: profile.data.researchedBy ?? "claude",
      researchedAt: profile.data.researchedAt ?? now.toISOString(),
    };
    const saved = await setOrganizationProfile(target.id, value);
    results.push(saved ? { index, ok: true, organizationId: target.id } : { index, ok: false, error: `Organization ${target.id} not found.` });
  }
  const updated = results.filter((r) => r.ok).length;
  return { ok: true, updated, failed: results.length - updated, results };
}

export async function listProfilesForProject(projectId: string | null, missingOnly: boolean) {
  if (!projectId || !z.guid().safeParse(projectId).success) throw new ProfilesError("Pass ?projectId=<uuid> (a campaign).", 400);
  const list = await listProjectOrganizations(projectId, { missingOnly });
  if (!list) throw new ProfilesError("Project not found.", 404);
  return {
    projectId: list.project.id,
    projectName: list.project.name,
    count: list.organizations.length,
    missingCount: list.organizations.filter((o) => !o.profile).length,
    organizations: list.organizations,
  };
}
