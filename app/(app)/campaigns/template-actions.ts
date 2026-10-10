"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { TEMPLATE_TRIGGERS } from "@/lib/constants";
import type { ActionOutcome, SheetSettingsInput, TemplateFormInput } from "@/lib/booking/types";
import { getSheet, updateSheetSettings } from "@/lib/queries/booking";
import {
  addStarterTemplates,
  copyTemplates,
  createTemplate,
  deleteTemplate,
  getTemplate,
  TEMPLATE_LIMITS,
  updateTemplate,
} from "@/lib/queries/templates";
import type { TemplateTrigger } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { idSchema, parseId } from "../_lib/validation";

/* Sheet settings ----------------------------------------------------------- */

const settingsSchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(120),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, e.g. EUR."),
  phonePrefix: z.string().trim().max(8),
  sendAccountId: z.union([z.literal(""), idSchema]),
  description: z.string().trim().max(2000),
});

/** Templates & settings page: name, currency, phone prefix, send-from account, description. */
export async function updateSheetSettingsAction(projectId: string, input: SheetSettingsInput): Promise<ActionOutcome> {
  await requireSession();
  const id = parseId(projectId);
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  try {
    await updateSheetSettings(id, {
      name: parsed.data.name,
      currency: parsed.data.currency,
      phonePrefix: parsed.data.phonePrefix || null,
      sendAccountId: parsed.data.sendAccountId || null,
      description: parsed.data.description || null,
    });
  } catch (error) {
    const message = errorMessage(error);
    return { ok: false, error: /duplicate|unique|already exists/i.test(message) ? "A project with that name already exists." : message };
  }
  refresh();
  return { ok: true };
}

/* Templates ---------------------------------------------------------------- */

const triggerSchema = z.enum(TEMPLATE_TRIGGERS.map((t) => t.value) as [TemplateTrigger, ...TemplateTrigger[]]);

const templateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name.").max(TEMPLATE_LIMITS.name),
  trigger: triggerSchema,
  subject: z.string().trim().max(TEMPLATE_LIMITS.subject),
  body: z.string().max(TEMPLATE_LIMITS.body),
  sortOrder: z.number().int().optional(),
});

/** A sheet's own template (projectId), or one for every sheet (projectId null). */
export async function createTemplateAction(projectId: string | null, input: TemplateFormInput): Promise<ActionOutcome<{ id: string }>> {
  await requireSession();
  const project = projectId === null ? null : parseId(projectId);
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  try {
    const id = await createTemplate({ ...parsed.data, projectId: project });
    refresh();
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function updateTemplateAction(templateId: string, input: TemplateFormInput): Promise<ActionOutcome> {
  await requireSession();
  const id = parseId(templateId);
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  try {
    await updateTemplate(id, parsed.data);
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  refresh();
  return { ok: true };
}

export async function deleteTemplateAction(templateId: string): Promise<ActionOutcome> {
  await requireSession();
  const id = parseId(templateId);
  if (!(await getTemplate(id))) return { ok: false, error: "Template not found" };
  await deleteTemplate(id);
  refresh();
  return { ok: true };
}

/** "Copy templates from another sheet": the other sheet's own templates, skipping names this sheet already uses. */
export async function copyTemplatesAction(fromProjectId: string, toProjectId: string): Promise<ActionOutcome<{ copied: number }>> {
  await requireSession();
  const from = parseId(fromProjectId);
  const to = parseId(toProjectId);
  if (from === to) return { ok: false, error: "Pick another campaign." };
  if (!(await getSheet(from)) || !(await getSheet(to))) return { ok: false, error: "Campaign not found" };
  const copied = await copyTemplates(from, to);
  refresh();
  return { ok: true, copied };
}

/** One starter template per situation (Spanish), for a sheet that has none yet. */
export async function addStarterTemplatesAction(projectId: string): Promise<ActionOutcome<{ added: number }>> {
  await requireSession();
  const id = parseId(projectId);
  if (!(await getSheet(id))) return { ok: false, error: "Campaign not found" };
  try {
    const added = await addStarterTemplates(id);
    refresh();
    return { ok: true, added };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
