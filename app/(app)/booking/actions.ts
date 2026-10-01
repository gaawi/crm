"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { addSheetRow, createSheet, updateSheetRow, type SheetRowPatch } from "@/lib/queries/booking";
import { deleteOpportunity, parseMoney } from "@/lib/queries/opportunities";
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import { field, longText, optionalDateSchema, parseId, shortText, stageSchema } from "../_lib/validation";

export async function createSheetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const name = field(formData, "name").replace(/\s+/g, " ").trim();
  if (!name) return { error: "Give the sheet a name." };
  let id: string;
  try {
    id = await createSheet({ name: name.slice(0, 120), currency: field(formData, "currency") || "USD" });
  } catch (error) {
    const message = errorMessage(error);
    return { error: /duplicate|unique/i.test(message) ? "A project with that name already exists." : message };
  }
  redirect(`/booking/${id}`);
}

const rowSchema = z.object({
  organization: shortText.min(1, "Name the venue or presenter."),
  city: shortText,
  website: shortText,
  contactName: shortText,
  role: shortText,
  email: z.string().trim().max(320),
  eventDates: shortText,
  fee: z.string().trim().max(30),
  followUpAt: optionalDateSchema,
  nextStep: shortText,
  notes: longText,
});

export async function addRowAction(projectId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(projectId);
  const parsed = rowSchema.safeParse(Object.fromEntries(Object.keys(rowSchema.shape).map((k) => [k, field(formData, k)])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  if (parsed.data.fee && parseMoney(parsed.data.fee) === null) return { error: "Fee must be a number." };
  try {
    await addSheetRow({ projectId: id, ...parsed.data });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh();
  return { message: "Added." };
}

const patchSchemas = {
  stage: stageSchema,
  followUpAt: optionalDateSchema,
  nextStep: shortText,
  eventDates: shortText,
  fee: z.string().trim().max(30),
  notes: longText,
} as const;

export type SheetField = keyof typeof patchSchemas;

/** Inline edit of one cell. */
export async function updateCellAction(rowId: string, name: SheetField, value: string): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const id = parseId(rowId);
  const schema = patchSchemas[name];
  if (!schema) return { ok: false, error: "Unknown field" };
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, error: name === "followUpAt" ? "Use a valid date." : "Invalid value." };
  if (name === "fee" && parsed.data && parseMoney(parsed.data as string) === null) return { ok: false, error: "Fee must be a number." };
  try {
    await updateSheetRow(id, { [name]: parsed.data || null } as SheetRowPatch);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  refresh();
  return { ok: true };
}

export async function deleteRowAction(rowId: string): Promise<void> {
  await requireSession();
  await deleteOpportunity(parseId(rowId));
  refresh();
}
