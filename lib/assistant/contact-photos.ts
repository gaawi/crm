import "server-only";
import { z } from "zod";
import { httpsUrlIssue, normalizeHttpsUrl } from "@/lib/contacts/photo";
import { contactExists, contactIdForEmail, listCampaignContacts, setContactPhoto } from "@/lib/queries/contact-photos";
import { isValidEmail } from "@/lib/utils";

/**
 * Contact photos found by Claude (POST /api/assistant-agent/contact-photos)
 * and the people of a campaign to look for (GET /api/assistant-agent/contacts).
 * Each item names its contact by id or by email address; every item succeeds
 * or fails on its own.
 */

export const MAX_PHOTOS_PER_CALL = 100;

const bodySchema = z.object({ photos: z.array(z.unknown()).min(1).max(MAX_PHOTOS_PER_CALL) });

const itemSchema = z.object({
  contactId: z.guid("contactId must be a uuid.").nullish(),
  email: z.string().trim().max(320).refine(isValidEmail, "Invalid email address.").nullish(),
  url: z.unknown(),
  source: z.unknown(),
});

export type PhotoItemResult =
  | { index: number; ok: true; contactId: string; photoUrl: string }
  | { index: number; ok: false; error: string; contactId?: string };

export interface ApplyPhotosResult {
  ok: true;
  updated: number;
  failed: number;
  results: PhotoItemResult[];
}

export class ContactPhotosError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function resolveContact(item: z.output<typeof itemSchema>): Promise<{ id: string } | { error: string }> {
  if (!item.contactId && !item.email) return { error: "Give contactId or email." };
  let byId: string | null = null;
  if (item.contactId) {
    if (!(await contactExists(item.contactId))) return { error: `Contact ${item.contactId} not found.` };
    byId = item.contactId.toLowerCase();
  }
  if (item.email) {
    const id = await contactIdForEmail(item.email);
    if (!id) return { error: `No contact with the address ${item.email}.` };
    if (byId && byId !== id) return { error: "contactId and email point to different contacts." };
    return { id };
  }
  return { id: byId! };
}

function zodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "item"}: ${issue.message}` : "Invalid item.";
}

export async function applyContactPhotos(body: unknown): Promise<ApplyPhotosResult> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ContactPhotosError(`Send {"photos": [{contactId | email, url, source}]} (1–${MAX_PHOTOS_PER_CALL} items).`, 400);
  }
  const results: PhotoItemResult[] = [];
  for (const [index, raw] of parsed.data.photos.entries()) {
    const item = itemSchema.safeParse(raw);
    if (!item.success) {
      results.push({ index, ok: false, error: zodIssue(item.error) });
      continue;
    }
    const urlIssue = httpsUrlIssue(item.data.url);
    if (urlIssue) {
      results.push({ index, ok: false, error: `url: ${urlIssue}` });
      continue;
    }
    const sourceIssue = httpsUrlIssue(item.data.source);
    if (sourceIssue) {
      results.push({ index, ok: false, error: `source: ${sourceIssue}` });
      continue;
    }
    const target = await resolveContact(item.data);
    if ("error" in target) {
      results.push({ index, ok: false, error: target.error });
      continue;
    }
    const url = normalizeHttpsUrl(item.data.url)!;
    const saved = await setContactPhoto(target.id, url, normalizeHttpsUrl(item.data.source));
    results.push(saved ? { index, ok: true, contactId: target.id, photoUrl: url } : { index, ok: false, error: `Contact ${target.id} not found.` });
  }
  const updated = results.filter((r) => r.ok).length;
  return { ok: true, updated, failed: results.length - updated, results };
}

export async function listContactsForProject(projectId: string | null, missingPhotoOnly: boolean) {
  if (!projectId || !z.guid().safeParse(projectId).success) throw new ContactPhotosError("Pass ?projectId=<uuid> (a campaign).", 400);
  const list = await listCampaignContacts(projectId, { missingPhotoOnly });
  if (!list) throw new ContactPhotosError("Project not found.", 404);
  return {
    projectId: list.project.id,
    projectName: list.project.name,
    count: list.contacts.length,
    contacts: list.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      displayName: c.displayName,
      role: c.role,
      emails: c.emails,
      organization: c.organization,
      photoUrl: c.photoUrl,
      photoSource: c.photoSource,
      opportunityIds: c.opportunityIds,
    })),
  };
}
