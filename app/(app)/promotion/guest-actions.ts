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

/** Someone added by hand on the concert's guest list page (not necessarily in the CRM). */
export async function addGuestAction(eventId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const name = field(formData, "name").trim().slice(0, 200);
  const email = field(formData, "email").trim().toLowerCase();
  const tickets = Number(field(formData, "tickets") || 2);
  const kind = kindSchema.safeParse(field(formData, "kind") || "guest");
  const note = field(formData, "note").trim().slice(0, 1000) || null;
  if (!name) return { error: "Write the guest's name." };
  if (email && !isValidEmail(email)) return { error: "That email address doesn't look right." };
  if (!kind.success) return { error: "Pick who they are." };
  try {
    await addGuest({ eventId: parseId(eventId), name, email: email || null, tickets, kind: kind.data, note });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh();
  return { message: "Added." };
}

/** A contact's places on the guest lists (for the chips on an approval card). */
export async function guestEntriesAction(contactId: string): Promise<{ id: string; eventId: string; tickets: number }[]> {
  await requireSession();
  const entries = await guestEntriesForContact(parseId(contactId));
  return entries.map((g) => ({ id: g.id, eventId: g.eventId, tickets: g.tickets }));
}
