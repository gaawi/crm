"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { OPPORTUNITY_STAGES } from "@/lib/constants";
import { createOpportunity, deleteOpportunity, getOpportunity, updateOpportunity } from "@/lib/queries/opportunities";
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import {
  field,
  longText,
  opportunityKindSchema,
  optionalDateSchema,
  optionalIdSchema,
  parseId,
  safeReturnPath,
  shortText,
  stageSchema,
} from "../_lib/validation";

const dealSchema = z.object({
  title: shortText.min(1, "Give the deal a title."),
  kind: opportunityKindSchema,
  stage: stageSchema,
  contactId: optionalIdSchema,
  organizationId: optionalIdSchema,
  projectId: optionalIdSchema,
  value: z.string().trim().max(30),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code like USD."),
  followUpAt: optionalDateSchema,
  nextStep: shortText,
  notes: longText,
});

/** Create (`dealId` null) or update a deal, then go back to `return`. */
export async function saveDeal(dealId: string | null, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = dealId === null ? null : parseId(dealId);
  const parsed = dealSchema.safeParse({
    title: field(formData, "title"),
    kind: field(formData, "kind"),
    stage: field(formData, "stage"),
    contactId: field(formData, "contactId"),
    organizationId: field(formData, "organizationId"),
    projectId: field(formData, "projectId"),
    value: field(formData, "value"),
    currency: field(formData, "currency") || "USD",
    followUpAt: field(formData, "followUpAt"),
    nextStep: field(formData, "nextStep"),
    notes: field(formData, "notes"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const labels: Record<string, string> = { followUpAt: "Follow-up date", value: "Value", kind: "Kind", stage: "Stage" };
    const label = labels[String(issue?.path[0])];
    return { error: label ? `${label} is invalid.` : (issue?.message ?? "Some fields are invalid.") };
  }
  const input = parsed.data;
  const values = { ...input, value: input.value || null, nextStep: input.nextStep || null, notes: input.notes || null };
  const back = safeReturnPath(field(formData, "return"), "/pipeline");

  try {
    if (id) await updateOpportunity(id, values);
    else await createOpportunity(values);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(back);
}

export async function deleteDeal(dealId: string, returnPath: string): Promise<ActionResult> {
  await requireSession();
  await deleteOpportunity(parseId(dealId));
  redirect(safeReturnPath(returnPath, "/pipeline"));
}

const NEXT_STAGE = Object.fromEntries(
  OPPORTUNITY_STAGES.filter((s) => s.open).map((s, i, open) => [s.value, open[i + 1]?.value ?? "won"]),
) as Record<string, z.infer<typeof stageSchema>>;

/** Move an open deal one stage forward (the last open stage goes to won). */
export async function advanceDeal(dealId: string): Promise<void> {
  await requireSession();
  const deal = await getOpportunity(parseId(dealId));
  if (!deal) throw new Error("Deal not found");
  const next = NEXT_STAGE[deal.stage];
  if (next) await updateOpportunity(deal.id, { stage: next });
  refresh();
}
