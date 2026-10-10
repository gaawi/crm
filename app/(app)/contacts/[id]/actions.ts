"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { addDays, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import {
  addContactEmail,
  addContactsToProject,
  deleteContact,
  EmailTakenError,
  getContact,
  mergeContacts,
  removeContactEmail,
  removeContactFromProject,
  setPrimaryEmail,
  updateContact,
} from "@/lib/queries/contacts";
import type { ActionOutcome } from "@/lib/booking/types";
import { httpsUrlIssue, normalizeHttpsUrl } from "@/lib/contacts/photo";
import { setContactPhoto } from "@/lib/queries/contact-photos";
import type { GoalInput, Opportunity } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "../../_components/action-form";
import { createGoalAction } from "../../pipeline/actions";
import { addMonths } from "../../_lib/format";
import {
  field,
  longText,
  optionalDateSchema,
  parseEmail,
  parseId,
  parseTags,
  shortText,
  statusSchema,
} from "../../_lib/validation";

const contactPath = (id: string, tab?: string) => (tab ? `/contacts/${id}?tab=${tab}` : `/contacts/${id}`);

/* Profile ------------------------------------------------------------------ */

const profileSchema = z.object({
  name: shortText,
  organization: shortText,
  role: shortText,
  status: statusSchema,
  tags: z.string().max(2000),
  notes: longText,
});

export async function updateProfile(contactId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(contactId);
  const parsed = profileSchema.safeParse({
    name: field(formData, "name"),
    organization: field(formData, "organization"),
    role: field(formData, "role"),
    status: field(formData, "status"),
    tags: field(formData, "tags"),
    notes: field(formData, "notes"),
  });
  if (!parsed.success) return { error: "Some fields are invalid or too long." };
  const input = parsed.data;
  // Phone fields are only changed when the form has them.
  const phones = phoneFields(formData);
  if ("error" in phones) return { error: phones.error };
  try {
    await updateContact(id, {
      name: input.name || null,
      organizationName: input.organization || null,
      role: input.role || null,
      status: input.status,
      tags: parseTags(input.tags),
      notes: input.notes || null,
      ...phones.values,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(contactPath(id, "details"));
}

/* Photo -------------------------------------------------------------------- */

/** Contact page → "Edit photo": an https image URL pasted by the owner (optional page it came from). */
export async function updatePhotoAction(contactId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(contactId);
  const url = field(formData, "photoUrl").trim();
  const issue = httpsUrlIssue(url);
  if (issue) return { error: issue === "Give an https URL." ? "Paste the https address of an image." : issue };
  const sourceRaw = field(formData, "photoSource").trim();
  if (sourceRaw && httpsUrlIssue(sourceRaw)) return { error: "The page address must be an https URL too." };
  if (!(await setContactPhoto(id, normalizeHttpsUrl(url), sourceRaw ? normalizeHttpsUrl(sourceRaw) : null))) return { error: "Contact not found." };
  redirect(contactPath(id));
}

export async function removePhotoAction(contactId: string): Promise<void> {
  await requireSession();
  await setContactPhoto(parseId(contactId), null);
  redirect(contactPath(parseId(contactId)));
}

/* Phone / WhatsApp --------------------------------------------------------- */

const phoneSchema = z.string().trim().max(60);

function phoneFields(formData: FormData): { values: { phone?: string | null; whatsapp?: string | null } } | { error: string } {
  const values: { phone?: string | null; whatsapp?: string | null } = {};
  for (const name of ["phone", "whatsapp"] as const) {
    if (!formData.has(name)) continue;
    const parsed = phoneSchema.safeParse(field(formData, name));
    if (!parsed.success) return { error: "The phone number is too long." };
    values[name] = parsed.data || null;
  }
  return { values };
}

/**
 * Set or clear the contact's phone and WhatsApp ("" clears; a key left out
 * is kept). Typed any way; stored normalized, without adding a country code.
 */
export async function updatePhonesAction(
  contactId: string,
  input: { phone?: string; whatsapp?: string },
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const id = parseId(contactId);
  const values: { phone?: string | null; whatsapp?: string | null } = {};
  for (const name of ["phone", "whatsapp"] as const) {
    if (input[name] === undefined) continue;
    const parsed = phoneSchema.safeParse(input[name]);
    if (!parsed.success) return { ok: false, error: "The phone number is too long." };
    values[name] = parsed.data || null;
  }
  try {
    await updateContact(id, values);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  refresh();
  return { ok: true };
}

/* Follow-up ---------------------------------------------------------------- */

const presetSchema = z.enum(["1w", "2w", "1m"]);

/** Quick follow-up: one week, two weeks or one month from today (keeps the note). */
export async function setFollowUpPreset(contactId: string, preset: "1w" | "2w" | "1m"): Promise<void> {
  await requireSession();
  const id = parseId(contactId);
  const today = todayIn(env.timezone);
  const when = presetSchema.parse(preset);
  const date = when === "1w" ? addDays(today, 7) : when === "2w" ? addDays(today, 14) : addMonths(today, 1);
  await updateContact(id, { followUpAt: date });
  refresh();
}

export async function clearFollowUp(contactId: string): Promise<void> {
  await requireSession();
  await updateContact(parseId(contactId), { followUpAt: null, followUpNote: null });
  refresh();
}

export async function saveFollowUp(contactId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(contactId);
  const date = optionalDateSchema.safeParse(field(formData, "followUpAt"));
  const note = shortText.safeParse(field(formData, "followUpNote"));
  if (!date.success) return { error: "Pick a valid date." };
  if (!note.success) return { error: "The note is too long." };
  await updateContact(id, { followUpAt: date.data, followUpNote: date.data ? note.data || null : null });
  refresh();
  return { message: date.data ? "Follow-up saved." : "Follow-up cleared." };
}

/* Goals -------------------------------------------------------------------- */

/**
 * Contact page → Goals → "New goal": what we want from this contact (kind),
 * with an optional next step. The contact's organization is linked; without a
 * title it is named "<goal label> · <organization or contact>".
 */
export async function addContactGoalAction(contactId: string, input: Omit<GoalInput, "contactId">): Promise<ActionOutcome<{ goal: Opportunity }>> {
  await requireSession();
  const id = parseId(contactId);
  return createGoalAction({ ...input, contactId: id });
}

/* Email addresses ---------------------------------------------------------- */

export interface AddEmailState {
  error?: string;
  message?: string;
  /** The address belongs to another contact: offer to merge it in. */
  taken?: { email: string; contactId: string; displayName: string };
  /** Increments on success so the form can clear its field. */
  added?: number;
}

export async function addEmail(contactId: string, prev: AddEmailState, formData: FormData): Promise<AddEmailState> {
  await requireSession();
  const id = parseId(contactId);
  const email = parseEmail(field(formData, "email"));
  if (!email) return { error: "Enter a valid email address." };
  try {
    await addContactEmail(id, email);
  } catch (error) {
    if (error instanceof EmailTakenError) {
      const owner = await getContact(error.contactId);
      return {
        error: `${error.email} already belongs to ${owner?.displayName ?? "another contact"}.`,
        taken: { email: error.email, contactId: error.contactId, displayName: owner?.displayName ?? error.email },
      };
    }
    return { error: errorMessage(error) };
  }
  refresh();
  return { message: `Added ${email}. Its email history is included now.`, added: (prev.added ?? 0) + 1 };
}

export async function makePrimaryEmail(contactId: string, email: string): Promise<void> {
  await requireSession();
  const address = parseEmail(email);
  if (!address) throw new Error("Invalid address");
  await setPrimaryEmail(parseId(contactId), address);
  refresh();
}

export async function removeEmail(contactId: string, email: string): Promise<void> {
  await requireSession();
  const address = parseEmail(email);
  if (!address) throw new Error("Invalid address");
  await removeContactEmail(parseId(contactId), address);
  refresh();
}

/* Projects ----------------------------------------------------------------- */

export async function toggleProject(contactId: string, projectId: string, member: boolean): Promise<void> {
  await requireSession();
  const id = parseId(contactId);
  const project = parseId(projectId);
  if (z.boolean().parse(member)) await removeContactFromProject(id, project);
  else await addContactsToProject([id], project);
  refresh();
}

/* Merge / archive / delete ------------------------------------------------- */

/** Merge `sourceId` into `targetId` (the source's addresses, history, projects and deals move; the source is deleted). */
export async function mergeIntoContact(targetId: string, sourceId: string): Promise<void> {
  await requireSession();
  const target = parseId(targetId);
  const source = parseId(sourceId);
  await mergeContacts(target, source);
  redirect(`/contacts/${target}?notice=merged`);
}

/** Merge from the add-address flow; reports errors inline instead of throwing. */
export async function mergeFromAddEmail(targetId: string, sourceId: string): Promise<ActionResult> {
  await requireSession();
  const target = parseId(targetId);
  const source = parseId(sourceId);
  try {
    await mergeContacts(target, source);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(`/contacts/${target}?tab=details&notice=merged`);
}

export async function archiveContact(contactId: string): Promise<void> {
  await requireSession();
  const id = parseId(contactId);
  await updateContact(id, { status: "archived" });
  redirect(contactPath(id));
}

export async function deleteContactAction(contactId: string): Promise<void> {
  await requireSession();
  await deleteContact(parseId(contactId));
  redirect("/contacts");
}
