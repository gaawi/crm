"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { normalizeFee } from "@/lib/booking/fee";
import type { ActionOutcome } from "@/lib/booking/types";
import { OPPORTUNITY_STAGES } from "@/lib/constants";
import {
  createOpportunity,
  defaultGoalTitle,
  deleteOpportunity,
  getOpportunity,
  updateOpportunity,
  type OpportunityInput,
} from "@/lib/queries/opportunities";
import type { GoalInput, Opportunity } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import {
  field,
  idSchema,
  longText,
  nextActionSchema,
  opportunityKindSchema,
  optionalDateSchema,
  optionalIdSchema,
  optionalNextActionSchema,
  parseId,
  safeReturnPath,
  shortText,
  stageSchema,
} from "../_lib/validation";

/* A deal is shown as a "goal": what we want from a contact / organization. */

const dealSchema = z.object({
  /** Optional for a new goal: defaultGoalTitle names it. */
  title: shortText,
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
  nextAction: optionalNextActionSchema,
  nextStep: shortText,
  notes: longText,
});

/**
 * Create (`dealId` null) or update a goal from the form, then go back to
 * `return`. Fields: title (a new goal without one is named "<goal label> ·
 * <organization or contact>"), kind (goal kind), stage, contactId,
 * organizationId, projectId, value, currency, followUpAt, nextAction ("" =
 * none), nextStep, notes.
 */
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
    nextAction: field(formData, "nextAction"),
    nextStep: field(formData, "nextStep"),
    notes: field(formData, "notes"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const labels: Record<string, string> = {
      followUpAt: "Follow-up date",
      value: "Value",
      kind: "Goal type",
      stage: "Stage",
      nextAction: "Next step",
    };
    const label = labels[String(issue?.path[0])];
    return { error: label ? `${label} is invalid.` : (issue?.message ?? "Some fields are invalid.") };
  }
  const input = parsed.data;
  const values = { ...input, value: input.value || null, nextStep: input.nextStep || null, notes: input.notes || null };
  const back = safeReturnPath(field(formData, "return"), "/pipeline");

  try {
    if (id) {
      if (!values.title) return { error: "Give the goal a title." };
      await updateOpportunity(id, values);
    } else {
      const title = values.title || (await defaultGoalTitle(values));
      if (!title) return { error: "Give the goal a title, or pick a contact or organization." };
      await createOpportunity({ ...values, title });
    }
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
  if (!deal) throw new Error("Goal not found");
  const next = NEXT_STAGE[deal.stage];
  if (next) await updateOpportunity(deal.id, { stage: next });
  refresh();
}

/* Goals without a form (contact page, Today, quick edits) ------------------ */

const goalSchema = z.object({
  title: shortText.optional(),
  kind: opportunityKindSchema.optional(),
  stage: stageSchema.optional(),
  contactId: idSchema.nullable().optional(),
  organizationId: idSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  value: z.union([z.string().trim().max(30), z.number()]).nullable().optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code like USD.")
    .optional(),
  followUpAt: z.union([optionalDateSchema, z.null()]).optional(),
  nextAction: z.union([z.literal(""), nextActionSchema]).nullable().optional(),
  nextStep: shortText.nullable().optional(),
  notes: longText.nullable().optional(),
});

function goalValues(data: z.infer<typeof goalSchema>): OpportunityInput {
  const values: OpportunityInput = {};
  for (const [key, value] of Object.entries(data) as [keyof OpportunityInput, unknown][]) {
    if (value === undefined) continue;
    (values as Record<string, unknown>)[key] = value === "" ? null : value;
  }
  if (!values.title?.trim()) delete values.title;
  if (typeof values.value === "string") {
    const amount = normalizeFee(values.value);
    if (amount === null) throw new Error("Value must be a number.");
    values.value = amount;
  }
  return values;
}

/**
 * New goal from anywhere (JSON, no redirect). Needs a title, a contact or an
 * organization; without a title it is named "<goal label> · <organization or
 * contact>" (defaultGoalTitle). Kind defaults to "other", stage to "lead".
 * Returns the goal.
 */
export async function createGoalAction(input: GoalInput): Promise<ActionOutcome<{ goal: Opportunity }>> {
  await requireSession();
  const parsed = goalSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  try {
    const values = goalValues(parsed.data);
    const title = values.title?.trim() || (await defaultGoalTitle(values));
    if (!title) return { ok: false, error: "Give the goal a title, or pick a contact or organization." };
    const id = await createOpportunity({ ...values, title });
    refresh();
    return { ok: true, goal: (await getOpportunity(id))! };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Patch a goal (any subset: kind, stage, nextAction, nextStep, followUpAt,
 * title, value, notes, links). nextAction "" / null clears it. Returns the goal.
 */
export async function updateGoalAction(goalId: string, patch: GoalInput): Promise<ActionOutcome<{ goal: Opportunity }>> {
  await requireSession();
  const id = idSchema.safeParse(goalId);
  if (!id.success) return { ok: false, error: "Goal not found" };
  const parsed = goalSchema.safeParse(patch ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  try {
    await updateOpportunity(id.data, goalValues(parsed.data));
    refresh();
    const goal = await getOpportunity(id.data);
    return goal ? { ok: true, goal } : { ok: false, error: "Goal not found" };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
