"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { addGuest, GUEST_KINDS, guestEntriesForContact, removeGuest, updateGuest, type GuestKind } from "@/lib/queries/guests";
import { errorMessage, isValidEmail } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import { field, parseId } from "../_lib/validation";

type Done = { ok: true } | { ok: false; error: string };

/** Guest lists show in Mail (contact cards), on contacts and in Promotion. */
function refresh() {
  revalidatePath("/promotion", "layout");
  revalidatePath("/mail", "layout");
  revalidatePath("/contacts", "layout");
}

async function attempt(run: () => Promise<unknown>): Promise<Done> {
  await requireSession();
  try {
    await run();
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  refresh();
  return { ok: true };
}

/** One tap on a contact card (2 tickets), or a contact picked on the guest list page (with its tickets). */
export async function addContactGuestAction(eventId: string, contactId: string, tickets?: number): Promise<Done> {
  return attempt(() => addGuest({ eventId: parseId(eventId), contactId: parseId(contactId), name: "", tickets }));
}

export async function setGuestTicketsAction(guestId: string, tickets: number): Promise<Done> {
  return attempt(() => updateGuest(parseId(guestId), { tickets }));
}

export async function checkInGuestAction(guestId: string, checkedIn: boolean): Promise<Done> {
  return attempt(() => updateGuest(parseId(guestId), { checkedIn }));
}

export async function removeGuestAction(guestId: string): Promise<Done> {
  return attempt(() => removeGuest(parseId(guestId)));
}

const kindSchema = z.enum(GUEST_KINDS.map((k) => k.value) as [GuestKind, ...GuestKind[]]);

function personFields(formData: FormData) {
  const time = field(formData, "callTime").trim();
  return {
    name: field(formData, "name").trim().slice(0, 200),
    email: field(formData, "email").trim().toLowerCase(),
    tickets: Number(field(formData, "tickets") || 1),
    kind: kindSchema.safeParse(field(formData, "kind") || "guest"),
    note: field(formData, "note").trim().slice(0, 1000) || null,
    role: field(formData, "role").trim().slice(0, 100) || null,
    phone: field(formData, "phone").trim().slice(0, 40) || null,
    callTime: time ? time.slice(0, 5) : null,
    // Only the staff form has the box; elsewhere it stays as it is.
    backup: formData.has("backupField") ? field(formData, "backup") === "on" : undefined,
  };
}

/**
 * Someone added on the concert's page: a guest, or staff and artists (role,
 * phone, call time). With a contact (picked from the search) they are linked
 * to it; anyone else goes by name.
 */
export async function addGuestAction(eventId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const f = personFields(formData);
  const contactId = field(formData, "contactId");
  if (!f.name && !contactId) return { error: "Write their name." };
  if (f.email && !isValidEmail(f.email)) return { error: "That email address doesn't look right." };
  if (!f.kind.success) return { error: "Pick who they are." };
  try {
    await addGuest({
      eventId: parseId(eventId),
      contactId: contactId ? parseId(contactId) : null,
      name: f.name,
      email: f.email || null,
      tickets: f.tickets,
      kind: f.kind.data,
      note: f.note,
      role: f.role,
      phone: f.phone,
      callTime: f.callTime,
      backup: f.backup,
    });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh();
  return { message: "Added." };
}

/** Change someone's details (name, who they are, role, phone, call time, backup, note). */
export async function updateGuestAction(guestId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const f = personFields(formData);
  if (!f.name) return { error: "Write their name." };
  if (!f.kind.success) return { error: "Pick who they are." };
  try {
    await updateGuest(parseId(guestId), { name: f.name, kind: f.kind.data, note: f.note, role: f.role, phone: f.phone, callTime: f.callTime, backup: f.backup });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh();
  return { message: "Saved." };
}

/** A contact's places on the guest lists (for the chips on an approval card). */
export async function guestEntriesAction(contactId: string): Promise<{ id: string; eventId: string; tickets: number }[]> {
  await requireSession();
  const entries = await guestEntriesForContact(parseId(contactId));
  return entries.map((g) => ({ id: g.id, eventId: g.eventId, tickets: g.tickets }));
}
