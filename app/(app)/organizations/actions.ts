"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import {
  createOrganization,
  deleteOrganization,
  getOrganizationByName,
  updateOrganization,
} from "@/lib/queries/organizations";
import {
  lines,
  orgProfileSchema,
  parseImageLines,
  parseLinkLines,
  parseVenueLines,
  profileIssue,
  PROFILE_KINDS,
  type OrgProfileInput,
} from "@/lib/organizations/profile";
import { getOrganizationProfile, setOrganizationProfile } from "@/lib/queries/org-profiles";
import { errorMessage, splitList } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import { field, longText, organizationKindSchema, parseId, parseTags, shortText } from "../_lib/validation";

const kindSchema = z.union([z.literal(""), organizationKindSchema]).transform((v) => (v === "" ? null : v));

const organizationSchema = z.object({
  name: shortText.min(1, "Name is required."),
  kind: kindSchema,
  city: shortText,
  domains: z.string().max(2000),
});

/** "harbor.org, www.harbor.org\nfoo.com" → list (normalized by the query layer). */
function parseDomains(value: string): string[] {
  return splitList(value.replace(/\s+/g, ","));
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export async function createOrganizationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = organizationSchema.safeParse({
    name: field(formData, "name"),
    kind: field(formData, "kind"),
    city: field(formData, "city"),
    domains: field(formData, "domains"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  const input = parsed.data;

  const existing = await getOrganizationByName(input.name);
  if (existing) return { error: `“${existing.name}” already exists.` };

  let id: string;
  try {
    id = await createOrganization({
      name: input.name,
      kind: input.kind,
      city: input.city || null,
      domains: parseDomains(input.domains),
    });
  } catch (error) {
    return { error: isUniqueViolation(error) ? `“${input.name}” already exists.` : errorMessage(error) };
  }
  redirect(`/organizations/${id}`);
}

const updateSchema = organizationSchema.extend({
  website: shortText,
  tags: z.string().max(2000),
  notes: longText,
});

export async function updateOrganizationAction(organizationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(organizationId);
  const parsed = updateSchema.safeParse({
    name: field(formData, "name"),
    kind: field(formData, "kind"),
    city: field(formData, "city"),
    domains: field(formData, "domains"),
    website: field(formData, "website"),
    tags: field(formData, "tags"),
    notes: field(formData, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  const input = parsed.data;

  const existing = await getOrganizationByName(input.name);
  if (existing && existing.id !== id) return { error: `Another organization is already called “${existing.name}”.` };

  try {
    await updateOrganization(id, {
      name: input.name,
      kind: input.kind,
      city: input.city || null,
      domains: parseDomains(input.domains),
      website: input.website || null,
      tags: parseTags(input.tags),
      notes: input.notes || null,
    });
  } catch (error) {
    return { error: isUniqueViolation(error) ? `Another organization is already called “${input.name}”.` : errorMessage(error) };
  }
  redirect(`/organizations/${id}?tab=info`);
}

export async function deleteOrganizationAction(organizationId: string): Promise<void> {
  await requireSession();
  await deleteOrganization(parseId(organizationId));
  redirect("/organizations");
}

/* Profile ------------------------------------------------------------------- */

const PROFILE_FIELD_LABEL: Record<string, string> = {
  summary: "Summary",
  programming: "Programs",
  venues: "Venues",
  fitForAdar: "Why ADAR",
  ideas: "Ideas",
  images: "Image URLs",
  links: "Links",
  highlights: "Highlights",
};

/**
 * The owner's edit of an organization's profile. Fields the form does not
 * show (people, sources, image credits) are kept from the stored profile.
 */
export async function updateOrganizationProfileAction(organizationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(organizationId);
  const stored = await getOrganizationProfile(id);
  if (!stored) return { error: "This organization no longer exists." };
  const previous = stored.profile;

  const images = parseImageLines(field(formData, "images"));
  if (images.invalid) return { error: `Image URLs must start with https:// (“${images.invalid.slice(0, 80)}”).` };
  const links = parseLinkLines(field(formData, "links"));
  if (links.invalid) return { error: `Links need an https:// address (“${links.invalid.slice(0, 80)}”).` };
  const kind = field(formData, "kind");

  const input: OrgProfileInput = {
    ...previous,
    summary: field(formData, "summary"),
    kind: (PROFILE_KINDS as readonly string[]).includes(kind) ? (kind as OrgProfileInput["kind"]) : undefined,
    location: field(formData, "location"),
    dates: field(formData, "dates"),
    scale: field(formData, "scale"),
    audience: field(formData, "audience"),
    programming: field(formData, "programming"),
    venues: parseVenueLines(field(formData, "venues")),
    highlights: lines(field(formData, "highlights")),
    fitForAdar: field(formData, "fitForAdar"),
    ideas: lines(field(formData, "ideas")),
    images: images.images.map((img) => {
      const before = previous?.images?.find((i) => i.url === img.url);
      return { url: img.url, caption: img.caption ?? before?.caption, source: before?.source };
    }),
    links: links.links,
    researchedBy: "owner",
    researchedAt: new Date().toISOString(),
  };
  const parsed = orgProfileSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = String(issue?.path[0] ?? "");
    if (key === "summary" && !input.summary.trim()) return { error: "Write a short summary first." };
    if (key === "images" && issue?.code === "too_big") return { error: "Up to 8 images." };
    return { error: PROFILE_FIELD_LABEL[key] ? `${PROFILE_FIELD_LABEL[key]}: ${issue?.message}` : profileIssue(parsed.error) };
  }
  await setOrganizationProfile(id, parsed.data);
  redirect(`/organizations/${id}`);
}

export async function removeOrganizationProfileAction(organizationId: string): Promise<void> {
  await requireSession();
  const id = parseId(organizationId);
  await setOrganizationProfile(id, null);
  redirect(`/organizations/${id}`);
}
