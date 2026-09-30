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
