import { z } from "zod";
import { noEmDash } from "@/lib/text/no-em-dash";

/**
 * A ticketing partner's relationship with us, summarized from the emails:
 * how offering tickets works, who we talk to, and what happened concert by
 * concert. Stored on listing_platforms.relationship and shown on its card.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? noEmDash(v) : null));
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((v) => v ?? null);

export const relationshipSchema = z.object({
  /** One short paragraph the owner reads at a glance. */
  summary: text(1000),
  howItWorks: text(3000),
  priceToMembers: text(300),
  paidToUs: text(300),
  typicalTickets: text(300),
  login: text(300),
  contacts: z
    .array(z.object({ name: text(200), email: text(320), role: text(200), lastSeen: date }))
    .max(20)
    .default([]),
  concerts: z
    .array(
      z.object({
        date,
        title: text(300),
        ticketsOffered: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null || v === "" ? null : String(v))),
        ticketsTaken: z.union([z.number(), z.string()]).nullish().transform((v) => (v == null || v === "" ? null : String(v))),
        priceToMembers: text(100),
        paidToUs: text(100),
        notes: text(500),
      }),
    )
    .max(100)
    .default([]),
  timeline: z
    .array(z.object({ date, direction: z.enum(["in", "out"]).nullish(), who: text(200), summary: text(600) }))
    .max(80)
    .default([]),
  openItems: z.array(z.string().trim().max(400).transform(noEmDash)).max(20).default([]),
  notes: text(3000),
  reviewedAt: date,
});

export type PartnerRelationship = z.output<typeof relationshipSchema>;
