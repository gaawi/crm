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
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "../../_components/action-form";
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
  try {
    await updateContact(id, {
      name: input.name || null,
      organizationName: input.organization || null,
      role: input.role || null,
      status: input.status,
      tags: parseTags(input.tags),
      notes: input.notes || null,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(contactPath(id, "details"));
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
export async function mergeFromAddEmail(targetId: string, sourceId: string, _prev: ActionResult): Promise<ActionResult> {
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
