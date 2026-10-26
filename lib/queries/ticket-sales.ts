import "server-only";
import { sql } from "@/lib/db";

/**
 * Tickets sold per concert and channel (concert_ticket_sales). ChatGPT keeps
 * the numbers up to date in the database; the app only shows them.
 */

export interface TicketSale {
  id: string;
  eventId: string;
  channel: string;
  /** Null until reported. */
  sold: number | null;
  note: string | null;
  updatedAt: Date;
}

/** A concert's channels, the reported ones (most sold) first. */
export async function ticketSales(eventId: string): Promise<TicketSale[]> {
  return sql<TicketSale[]>`
    select id, event_id, channel, sold, note, updated_at from concert_ticket_sales
     where event_id = ${eventId}
     order by sold desc nulls last, lower(channel)`;
}

/** Tickets sold per concert (only the concerts with a reported number). */
export async function ticketsSoldByEvent(eventIds: string[]): Promise<Map<string, number>> {
  if (!eventIds.length) return new Map();
  const rows = await sql<{ eventId: string; sold: number }[]>`
    select event_id, sum(sold)::int as sold from concert_ticket_sales
     where event_id = any(${eventIds}::uuid[]) and sold is not null
     group by event_id`;
  return new Map(rows.map((r) => [r.eventId, r.sold]));
}
