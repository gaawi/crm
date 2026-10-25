import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
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
import {
  findPlatformByName,
  listListingEvents,
  platformsForEvent,
  saveEvent,
  savePlatform,
  saveSubmission,
} from "@/lib/queries/listings";
import { relationshipSchema } from "@/lib/listings/relationship";
import { noEmDash } from "@/lib/text/no-em-dash";
import { isValidEmail } from "@/lib/utils";

/**
 * Promotion for an assistant (Claude, a ChatGPT agent with the token):
 * read the concerts, the platforms and where each concert was sent; add or
 * update platforms (matched by name), concerts and submissions.
 */

export class ListingsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function listingsOverview(eventId: string | null) {
  const events = await listListingEvents();
  const event = eventId ? events.find((e) => e.id === eventId) : undefined;
  if (eventId && !event) throw new ListingsError("No concert with that id.", 404);
  const platforms = await platformsForEvent(event?.id ?? null);
  return {
    events: events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, timeZone: e.timeZone, venue: e.venue, counts: e.counts })),
    event: event ?? null,
    platforms,
  };
}

const url = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => /^https?:\/\/[^\s/]+[^\s]*$/i.test(v), "must be an http(s) URL")
  .nullish();
const txt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? noEmDash(v) : v));

const platformSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(PLATFORM_KINDS.map((k) => k.value) as [PlatformKind, ...PlatformKind[]]).optional(),
  tier: z.enum(PLATFORM_TIERS.map((t) => t.value) as [PlatformTier, ...PlatformTier[]]).optional(),
  website: url,
  submitUrl: url,
  email: z
    .string()
    .trim()
    .max(320)
    .refine(isValidEmail, "invalid email")
    .nullish()
    .transform((v) => v?.toLowerCase()),
  method: z.enum(LISTING_METHODS.map((m) => m.value) as [ListingMethod, ...ListingMethod[]]).optional(),
  loginRequired: z.boolean().optional(),
  loginAccount: txt(300),
  cost: z.enum(LISTING_COSTS.map((c) => c.value) as [ListingCost, ...ListingCost[]]).optional(),
  costNote: txt(300),
  leadDays: z.number().int().min(0).max(365).nullish(),
  audience: txt(300),
  fields: txt(2000),
  instructions: txt(4000),
  notes: txt(4000),
  /** Addresses or domains we talk to them from ("molly@piptix.com", "tdf.org"). */
  emailMatch: z
    .array(z.string().trim().toLowerCase().min(3).max(320).regex(/^[^\s@]*@?[a-z0-9.-]+\.[a-z]{2,}$/, "an email address or a domain"))
    .max(20)
    .optional(),
  relationship: relationshipSchema.nullish(),
});

const eventSchema = z.object({
  id: z.guid().optional(),
  title: z.string().trim().min(1).max(300),
  date: z.iso.date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  timeZone: z.string().trim().min(1).max(64).optional(),
  venue: txt(300),
  address: txt(500),
  ticketUrl: url,
  infoUrl: url,
  imageUrl: url,
  prices: txt(300),
  description: txt(6000),
  notes: txt(4000),
});

const submissionSchema = z.object({
  /** The concert's id, or its exact title. */
  event: z.string().trim().min(1).max(300),
  /** The platform's id, or its name. */
  platform: z.string().trim().min(1).max(200),
  status: z.enum(SUBMISSION_STATUSES.map((s) => s.value) as [SubmissionStatus, ...SubmissionStatus[]]).optional(),
  sentAt: z.iso.date().nullish(),
  sentBy: txt(100),
  confirmationUrl: url,
  publicUrl: url,
  notes: txt(4000),
  ticketsOffered: z.number().int().min(0).max(10000).nullish(),
  ticketsTaken: z.number().int().min(0).max(10000).nullish(),
  memberPrice: txt(100),
});

const bodySchema = z.object({
  events: z.array(z.unknown()).max(20).optional(),
  platforms: z.array(z.unknown()).max(200).optional(),
  submissions: z.array(z.unknown()).max(200).optional(),
});

type Result = { index: number; ok: true; id: string; created?: boolean } | { index: number; ok: false; error: string };

function issue(error: z.ZodError): string {
  const first = error.issues[0];
  return first ? `${first.path.join(".") || "item"}: ${first.message}` : "Invalid item.";
}

export async function applyListings(body: unknown) {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw new ListingsError('Send {"events"?: [...], "platforms"?: [...], "submissions"?: [...]}.', 400);
  const out: { events: Result[]; platforms: Result[]; submissions: Result[] } = { events: [], platforms: [], submissions: [] };

  for (const [index, raw] of (parsed.data.events ?? []).entries()) {
    const item = eventSchema.safeParse(raw);
    if (!item.success) {
      out.events.push({ index, ok: false, error: issue(item.error) });
      continue;
    }
    try {
      const { id, ...input } = item.data;
      const saved = await saveEvent(input, id);
      out.events.push({ index, ok: true, id: saved, created: !id });
    } catch (error) {
      out.events.push({ index, ok: false, error: error instanceof Error ? error.message : "Could not save." });
    }
  }

  for (const [index, raw] of (parsed.data.platforms ?? []).entries()) {
    const item = platformSchema.safeParse(raw);
    if (!item.success) {
      out.platforms.push({ index, ok: false, error: issue(item.error) });
      continue;
    }
    try {
      const existing = await findPlatformByName(item.data.name);
      // Only the fields sent change on an existing platform.
      const input = Object.fromEntries(Object.entries(item.data).filter(([, v]) => v !== undefined)) as typeof item.data;
      // Matched by name regardless of case: the stored spelling stays.
      if (existing) input.name = existing.name;
      const id = await savePlatform(input, existing?.id);
      out.platforms.push({ index, ok: true, id, created: !existing });
    } catch (error) {
      out.platforms.push({ index, ok: false, error: error instanceof Error ? error.message : "Could not save." });
    }
  }

  for (const [index, raw] of (parsed.data.submissions ?? []).entries()) {
    const item = submissionSchema.safeParse(raw);
    if (!item.success) {
      out.submissions.push({ index, ok: false, error: issue(item.error) });
      continue;
    }
    const { event, platform, ...input } = item.data;
    const matches = await sql<{ id: string }[]>`
      select id from listing_events where id::text = ${event} or lower(title) = lower(${event}) limit 2`;
    if (matches.length > 1) {
      out.submissions.push({ index, ok: false, error: `Several concerts are called "${event}": send its id.` });
      continue;
    }
    const ev = matches[0];
    const [pl] = await sql<{ id: string }[]>`
      select id from listing_platforms where id::text = ${platform} or lower(name) = lower(${platform}) limit 1`;
    if (!ev) {
      out.submissions.push({ index, ok: false, error: `No concert "${event}".` });
      continue;
    }
    if (!pl) {
      out.submissions.push({ index, ok: false, error: `No platform "${platform}": add it under "platforms" first.` });
      continue;
    }
    const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const id = await saveSubmission(ev.id, pl.id, clean);
    out.submissions.push({ index, ok: true, id });
  }
  return { ok: true, ...out };
}
