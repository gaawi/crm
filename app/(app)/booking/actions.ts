"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { IMPORT_MAX_BYTES } from "@/lib/booking/csv-import";
import { normalizeFee } from "@/lib/booking/fee";
import type { ActionOutcome, ImportResult, PrepareEmailsResult, SheetField, Timeline } from "@/lib/booking/types";
import { timelineForRow } from "@/lib/queries/activities";
import { addSheetRow, bulkUpdateSheetRows, createSheet, importSheetRows, updateSheetRow, type SheetRowPatch } from "@/lib/queries/booking";
import { PREPARE_MAX_ROWS, prepareSheetEmails } from "@/lib/queries/booking-emails";
import { deleteOpportunity } from "@/lib/queries/opportunities";
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import {
  field,
  idSchema,
  longText,
  nextActionSchema,
  opportunityKindSchema,
  optionalDateSchema,
  optionalNextActionSchema,
  parseId,
  shortText,
  stageSchema,
} from "../_lib/validation";

export type { SheetField };

export async function createSheetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const name = field(formData, "name").replace(/\s+/g, " ").trim();
  if (!name) return { error: "Give the sheet a name." };
  let id: string;
  try {
    id = await createSheet({
      name: name.slice(0, 120),
      currency: field(formData, "currency") || "USD",
      phonePrefix: field(formData, "phonePrefix").slice(0, 8) || null,
    });
  } catch (error) {
    const message = errorMessage(error);
    return { error: /duplicate|unique/i.test(message) ? "A project with that name already exists." : message };
  }
  redirect(`/booking/${id}`);
}

const phoneText = z.string().trim().max(60);

const rowSchema = z.object({
  organization: shortText.min(1, "Name the venue or presenter."),
  city: shortText,
  website: shortText,
  spaces: z.string().trim().max(1000),
  section: z.string().trim().max(120),
  contactName: shortText,
  role: shortText,
  email: z.string().trim().max(320),
  phone: phoneText,
  whatsapp: phoneText,
  eventDates: shortText,
  fee: z.string().trim().max(30),
  followUpAt: optionalDateSchema,
  nextAction: optionalNextActionSchema,
  nextStep: shortText,
  notes: longText,
  /** "" = booking. */
  kind: z.union([z.literal(""), opportunityKindSchema]).transform((v) => v || "booking"),
});

/**
 * Add-venue form. A checkbox named "returning" marks a venue we worked with
 * before; `kind` (goal, default booking) and `nextAction` are optional fields.
 */
export async function addRowAction(projectId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = parseId(projectId);
  const parsed = rowSchema.safeParse(Object.fromEntries(Object.keys(rowSchema.shape).map((k) => [k, field(formData, k)])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  if (parsed.data.fee && normalizeFee(parsed.data.fee) === null) return { error: "Fee must be a number." };
  const returning = ["on", "true", "1"].includes(field(formData, "returning"));
  try {
    await addSheetRow({ projectId: id, ...parsed.data, returning });
  } catch (error) {
    return { error: errorMessage(error) };
  }
  refresh();
  return { message: "Added." };
}

const patchSchemas = {
  stage: stageSchema,
  kind: opportunityKindSchema,
  followUpAt: optionalDateSchema,
  nextAction: optionalNextActionSchema,
  nextStep: shortText,
  eventDates: shortText,
  fee: z.string().trim().max(30),
  notes: longText,
  section: z.string().trim().max(120),
  spaces: z.string().trim().max(1000),
  returning: z.enum(["true", "false", "1", "0", "on", "off", ""]).transform((v) => v === "true" || v === "1" || v === "on"),
  phone: phoneText,
  whatsapp: phoneText,
} satisfies Record<SheetField, z.ZodType>;

/**
 * Inline edit of one cell. `value` is the text typed ("" clears); for
 * `returning` "true" / "false"; for `stage` a stage value ("won" = Confirmed:
 * also how the timeline's Confirmed / Declined buttons set the status); for
 * `kind` a goal kind; for `nextAction` a next action value ("" clears). A
 * status change is logged in the row's history.
 */
export async function updateCellAction(rowId: string, name: SheetField, value: string): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const id = parseId(rowId);
  const schema = Object.hasOwn(patchSchemas, name) ? patchSchemas[name] : null;
  if (!schema) return { ok: false, error: "Unknown field" };
  const parsed = schema.safeParse(typeof value === "string" ? value : String(value));
  if (!parsed.success) return { ok: false, error: name === "followUpAt" ? "Use a valid date." : "Invalid value." };
  if (name === "fee" && parsed.data && normalizeFee(parsed.data as string) === null) return { ok: false, error: "Fee must be a number." };
  try {
    const data = parsed.data;
    await updateSheetRow(id, { [name]: typeof data === "string" ? data || null : data } as SheetRowPatch);
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

const rowIdsSchema = z.array(idSchema).min(1, "Select at least one row.").max(500, "Select at most 500 rows.");

const bulkSchema = z
  .object({
    stage: stageSchema.optional(),
    section: z.string().trim().max(120).nullable().optional(),
    kind: opportunityKindSchema.optional(),
    nextAction: z.union([z.literal(""), nextActionSchema]).nullable().optional(),
  })
  .refine((p) => p.stage !== undefined || p.section !== undefined || p.kind !== undefined || p.nextAction !== undefined, "Nothing to change.");

/**
 * Bulk bar: "Set status…" ({ stage }), "Set section…" ({ section }, "" / null
 * = no section), "Set goal…" ({ kind }) or "Set next step…" ({ nextAction },
 * "" / null clears). Keys can be combined.
 */
export async function bulkUpdateRowsAction(
  projectId: string,
  rowIds: string[],
  patch: { stage?: string; section?: string | null; kind?: string; nextAction?: string | null },
): Promise<ActionOutcome<{ updated: number }>> {
  await requireSession();
  const id = parseId(projectId);
  const ids = rowIdsSchema.safeParse(rowIds);
  if (!ids.success) return { ok: false, error: ids.error.issues[0]?.message ?? "Invalid selection." };
  const parsed = bulkSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid value." };
  try {
    const updated = await bulkUpdateSheetRows(id, ids.data, {
      ...(parsed.data.stage !== undefined ? { stage: parsed.data.stage } : {}),
      ...(parsed.data.section !== undefined ? { section: parsed.data.section || null } : {}),
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.nextAction !== undefined ? { nextAction: parsed.data.nextAction || null } : {}),
    });
    refresh();
    return { ok: true, updated };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** The row's history for the drawer: activities and emails, newest first. */
export async function timelineAction(rowId: string): Promise<ActionOutcome<{ timeline: Timeline }>> {
  await requireSession();
  const id = idSchema.safeParse(rowId);
  if (!id.success) return { ok: false, error: "Row not found" };
  const timeline = await timelineForRow(id.data);
  return timeline ? { ok: true, timeline } : { ok: false, error: "Row not found" };
}

/**
 * "Prepare email(s)": one proposal per row in Approvals (with a Gmail draft),
 * from `templateId` or each row's suggested template. Never sends. More than
 * one prepared → they form a campaign (`campaignId`, status draft) that the
 * owner approves in Approvals before anything is sent, gradually.
 */
export async function prepareEmailsAction(
  projectId: string,
  rowIds: string[],
  templateId?: string | null,
): Promise<ActionOutcome<PrepareEmailsResult>> {
  await requireSession();
  const id = parseId(projectId);
  const ids = z.array(idSchema).min(1, "Select at least one row.").max(PREPARE_MAX_ROWS, `Prepare at most ${PREPARE_MAX_ROWS} emails at a time.`).safeParse(rowIds);
  if (!ids.success) return { ok: false, error: ids.error.issues[0]?.message ?? "Invalid selection." };
  const template = templateId ? idSchema.safeParse(templateId) : null;
  if (template && !template.success) return { ok: false, error: "Template not found" };
  try {
    const result = await prepareSheetEmails({ projectId: id, rowIds: ids.data, templateId: template?.data ?? null });
    refresh();
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Import pasted text / a CSV or TSV file's text (≤ 1 MB, ≤ 1000 rows). */
export async function importRowsAction(projectId: string, text: string): Promise<ActionOutcome<ImportResult>> {
  await requireSession();
  const id = parseId(projectId);
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "Paste the rows or pick a file first." };
  if (text.length > IMPORT_MAX_BYTES) return { ok: false, error: "The text is larger than 1 MB. Split it into smaller files." };
  try {
    const result = await importSheetRows(id, text);
    refresh();
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
