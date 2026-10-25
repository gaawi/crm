"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import {
  LISTING_COSTS,
  LISTING_METHODS,
  PLATFORM_KINDS,
  PLATFORM_TIERS,
  SUBMISSION_STATUSES,
  type ListingCost,
  type ListingMethod,
  type PlatformKind,
  type PlatformTier,
  type SubmissionStatus,
} from "@/lib/listings/constants";
import { deletePlatform, saveEvent, savePlatform, saveSubmission } from "@/lib/queries/listings";
import { errorMessage, isValidEmail } from "@/lib/utils";
import type { ActionResult } from "../_components/action-form";
import { field, optionalDateSchema, parseId } from "../_lib/validation";

const urlSchema = z
  .string()
  .trim()
  .max(2048)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => v === "" || /^https?:\/\/[^\s/]+[^\s]*$/i.test(v), "One of the links doesn't look like a web address.")
  .transform((v) => v || null);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "One of the fields is too long.")
    .transform((v) => v || null);

const statusSchema = z.enum(SUBMISSION_STATUSES.map((s) => s.value) as [SubmissionStatus, ...SubmissionStatus[]]);
const methodSchema = z.enum(LISTING_METHODS.map((m) => m.value) as [ListingMethod, ...ListingMethod[]]);
const costSchema = z.enum(LISTING_COSTS.map((c) => c.value) as [ListingCost, ...ListingCost[]]);
const kindSchema = z.enum(PLATFORM_KINDS.map((k) => k.value) as [PlatformKind, ...PlatformKind[]]);
const tierSchema = z.enum(PLATFORM_TIERS.map((t) => t.value) as [PlatformTier, ...PlatformTier[]]);

const platformSchema = z.object({
  name: z.string().trim().min(1, "Give the platform a name.").max(200),
  kind: kindSchema,
  tier: tierSchema,
  website: urlSchema,
  submitUrl: urlSchema,
  email: z
    .string()
    .trim()
    .max(320)
    .refine((v) => v === "" || isValidEmail(v), "The email doesn't look right.")
    .transform((v) => v.toLowerCase() || null),
  method: methodSchema,
  loginRequired: z.boolean(),
  loginAccount: text(300),
  cost: costSchema,
  costNote: text(300),
  leadDays: z
    .string()
    .trim()
    .regex(/^\d{0,3}$/, "Lead time is a number of days.")
    .transform((v) => (v ? Math.min(Number(v), 365) : null)),
  audience: text(300),
  fields: text(2000),
  instructions: text(4000),
  notes: text(4000),
  emailMatch: z
    .string()
    .max(2000)
    .transform((v) => [...new Set(v.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))])
    .refine((list) => list.length <= 20 && list.every((e) => /^[^\s@]*@?[a-z0-9.-]+\.[a-z]{2,}$/.test(e)), "Emails to match: addresses or domains, separated by commas."),
});

function platformFields(formData: FormData) {
  return platformSchema.safeParse({
    name: field(formData, "name"),
    kind: field(formData, "kind") || "calendar",
    tier: field(formData, "tier") || "sometimes",
    website: field(formData, "website"),
    submitUrl: field(formData, "submitUrl"),
    email: field(formData, "email"),
    method: field(formData, "method") || "form",
    loginRequired: field(formData, "loginRequired") === "on",
    loginAccount: field(formData, "loginAccount"),
    cost: field(formData, "cost") || "unknown",
    costNote: field(formData, "costNote"),
    leadDays: field(formData, "leadDays"),
    audience: field(formData, "audience"),
    fields: field(formData, "fields"),
    instructions: field(formData, "instructions"),
    notes: field(formData, "notes"),
    emailMatch: field(formData, "emailMatch"),
  });
}

/** Add a platform, or save the edited one (bound id). */
export async function savePlatformAction(platformId: string | null, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = platformId ? parseId(platformId) : undefined;
  const parsed = platformFields(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  try {
    await savePlatform(parsed.data, id);
  } catch (error) {
    const message = errorMessage(error);
    return { error: /listing_platforms_name_idx|duplicate key/.test(message) ? "There is already a platform with that name." : message };
  }
  revalidatePath("/promotion", "layout");
  return { message: id ? "Saved." : "Platform added." };
}

export async function deletePlatformAction(platformId: string): Promise<void> {
  await requireSession();
  await deletePlatform(parseId(platformId));
  revalidatePath("/promotion", "layout");
}

const eventSchema = z.object({
  title: z.string().trim().min(1, "Give the concert a title.").max(300),
  date: z.iso.date("Pick the date."),
  time: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, "Pick the time."),
  venue: text(300),
  address: text(500),
  ticketUrl: urlSchema,
  infoUrl: urlSchema,
  imageUrl: urlSchema,
  prices: text(300),
  description: text(6000),
  notes: text(4000),
});

/** New concert (then open it), or save the edited one. */
export async function saveEventAction(eventId: string | null, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const id = eventId ? parseId(eventId) : undefined;
  const parsed = eventSchema.safeParse({
    title: field(formData, "title"),
    date: field(formData, "date"),
    time: field(formData, "time"),
    venue: field(formData, "venue"),
    address: field(formData, "address"),
    ticketUrl: field(formData, "ticketUrl"),
    infoUrl: field(formData, "infoUrl"),
    imageUrl: field(formData, "imageUrl"),
    prices: field(formData, "prices"),
    description: field(formData, "description"),
    notes: field(formData, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  let saved: string;
  try {
    saved = await saveEvent({ ...parsed.data, timeZone: field(formData, "timeZone") || undefined }, id);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/promotion", "layout");
  if (!id) redirect(`/promotion/c/${saved}`);
  return { message: "Saved." };
}

/** The status picker on a row: changes only the status (today's date when it becomes sent). */
export async function setStatusAction(eventId: string, platformId: string, formData: FormData): Promise<void> {
  await requireSession();
  const status = statusSchema.parse(field(formData, "status"));
  await saveSubmission(parseId(eventId), parseId(platformId), { status });
  revalidatePath("/promotion", "layout");
}

const ticketCount = z
  .string()
  .trim()
  .regex(/^\d{0,5}$/, "Tickets is a number.")
  .transform((v) => (v ? Number(v) : null));

const submissionSchema = z.object({
  ticketsOffered: ticketCount,
  ticketsTaken: ticketCount,
  memberPrice: text(100),
  /** Left out when the screen changes the status on its own. */
  status: statusSchema.optional(),
  sentAt: optionalDateSchema,
  sentBy: text(100),
  confirmationUrl: urlSchema,
  publicUrl: urlSchema,
  notes: text(4000),
});

/** The full row editor: status, date, who sent it, links and notes for this concert. */
export async function saveSubmissionAction(eventId: string, platformId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();
  const parsed = submissionSchema.safeParse({
    ticketsOffered: field(formData, "ticketsOffered"),
    ticketsTaken: field(formData, "ticketsTaken"),
    memberPrice: field(formData, "memberPrice"),
    status: field(formData, "status") || undefined,
    sentAt: field(formData, "sentAt"),
    sentBy: field(formData, "sentBy"),
    confirmationUrl: field(formData, "confirmationUrl"),
    publicUrl: field(formData, "publicUrl"),
    notes: field(formData, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some fields are invalid." };
  try {
    await saveSubmission(parseId(eventId), parseId(platformId), parsed.data);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath("/promotion", "layout");
  return { message: "Saved." };
}
