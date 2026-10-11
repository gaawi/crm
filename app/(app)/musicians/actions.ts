"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { ROSTER_STATUSES, type RosterStatus } from "@/lib/musicians/instruments";
import { createContact, getContactByEmail } from "@/lib/queries/contacts";
import { addGig, deleteGig, getMusicianProfile, removeMusicianProfile, saveMusicianProfile } from "@/lib/queries/musicians";
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import { field, optionalDateSchema, optionalIdSchema, parseEmail, parseId, shortText } from "../_lib/validation";

const musicianPath = (contactId: string) => `/contacts/${contactId}?tab=details#musician`;

const rosterSchema = z.enum(ROSTER_STATUSES.map((s) => s.value) as [RosterStatus, ...RosterStatus[]]);
const websiteSchema = z
  .string()
  .trim()
  .max(2048)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => v === "" || /^https?:\/\/[^\s/]+[^\s]*$/i.test(v), "The website doesn't look like a web address.");
const ratingSchema = z
  .string()
  .trim()
  .regex(/^[1-5]?$/)
  .transform((v) => (v ? Number(v) : null));

const profileSchema = z.object({
  instruments: z.string().max(1000),
  basedIn: shortText,
  website: websiteSchema,
  roster: rosterSchema,
  notes: z.string().max(5000),
});

/** Contact page → Musician card → Save. The private rating is saved only when its fields are in the form. */
export async function saveMusicianAction(contactId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(contactId);
  const parsed = profileSchema.safeParse({
    instruments: field(formData, "instruments"),
    basedIn: field(formData, "basedIn"),
    website: field(formData, "website"),
    roster: field(formData, "roster") || "maybe",
    notes: field(formData, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid or too long." };
  const rating: { rating?: number | null; ratingNote?: string | null } = {};
  if (formData.has("rating")) {
    const r = ratingSchema.safeParse(field(formData, "rating"));
    if (!r.success) return { error: "Pick a rating from 1 to 5, or none." };
    rating.rating = r.data;
    const note = field(formData, "ratingNote").trim();
    if (note.length > 2000) return { error: "The private note is too long." };
    rating.ratingNote = note || null;
  }
  try {
    await saveMusicianProfile(id, {
      instruments: parsed.data.instruments,
      basedIn: parsed.data.basedIn || null,
      website: parsed.data.website || null,
      roster: parsed.data.roster,
      notes: parsed.data.notes.trim() || null,
      ...rating,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(musicianPath(id));
}

/** "Mark as musician": an empty profile, then straight to its form. */
export async function markMusicianAction(contactId: string): Promise<void> {
  await requireSession();
  const id = parseId(contactId);
  if (!(await getMusicianProfile(id))) await saveMusicianProfile(id, {});
  redirect(`/contacts/${id}?tab=details&edit=musician#musician`);
}

export async function removeMusicianAction(contactId: string): Promise<void> {
  await requireSession();
  const id = parseId(contactId);
  await removeMusicianProfile(id);
  redirect(`/contacts/${id}?tab=details`);
}

const gigSchema = z.object({
  title: z.string().trim().min(1, "Say what they played (concert, programme or project).").max(300),
  playedOn: optionalDateSchema,
  projectId: optionalIdSchema,
  instrument: shortText,
  notes: z.string().trim().max(2000),
});

export async function addGigAction(contactId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(contactId);
  const parsed = gigSchema.safeParse({
    title: field(formData, "title"),
    playedOn: field(formData, "playedOn"),
    projectId: field(formData, "projectId"),
    instrument: field(formData, "instrument"),
    notes: field(formData, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  try {
    await addGig(id, parsed.data);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(musicianPath(id));
}

export async function deleteGigAction(contactId: string, gigId: string): Promise<void> {
  await requireSession();
  const id = parseId(contactId);
  await deleteGig(id, parseId(gigId));
  redirect(musicianPath(id));
}

const newMusicianSchema = z.object({
  name: z.string().trim().min(1, "Give their name.").max(300),
  email: z.string().trim().max(320),
  instruments: z.string().trim().min(1, "Add at least one instrument (or voice).").max(1000),
  basedIn: shortText,
  website: websiteSchema,
});

/**
 * /musicians → "Add a musician". An email that already belongs to a contact
 * marks that contact as a musician instead of creating a duplicate.
 */
export async function addMusicianAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = newMusicianSchema.safeParse({
    name: field(formData, "name"),
    email: field(formData, "email"),
    instruments: field(formData, "instruments"),
    basedIn: field(formData, "basedIn"),
    website: field(formData, "website"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  const input = parsed.data;
  let email: string | null = null;
  if (input.email) {
    email = parseEmail(input.email);
    if (!email) return { error: "That email address doesn't look valid." };
  }
  let contactId: string;
  try {
    const existing = email ? await getContactByEmail(email) : null;
    contactId = existing ? existing.id : await createContact({ name: input.name, emails: email ? [email] : [], status: "active" });
    const current = await getMusicianProfile(contactId);
    await saveMusicianProfile(contactId, {
      instruments: [...(current?.instruments ?? []), ...input.instruments.split(/[,;\n·]+/)],
      ...(input.basedIn ? { basedIn: input.basedIn } : {}),
      ...(input.website ? { website: input.website } : {}),
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(musicianPath(contactId));
}
