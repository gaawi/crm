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

function checkSold(sold: number | null) {
  if (sold !== null && (!Number.isInteger(sold) || sold < 0 || sold > 100_000)) throw new Error("Tickets sold is a whole number.");
}

/** A channel's number set by hand (null = not reported). */
export async function updateTicketSale(id: string, patch: { sold: number | null; note: string | null }): Promise<void> {
  checkSold(patch.sold);
  await sql`update concert_ticket_sales set sold = ${patch.sold}, note = ${patch.note} where id = ${id}`;
}

/** A channel added by hand; one already there (any capitalization) gets the number instead. */
export async function addTicketChannel(eventId: string, input: { channel: string; sold: number | null; note: string | null }): Promise<void> {
  const channel = input.channel.trim();
  if (!channel) throw new Error("Name the channel.");
  checkSold(input.sold);
  await sql`
    insert into concert_ticket_sales (event_id, channel, sold, note)
    values (${eventId}, ${channel}, ${input.sold}, ${input.note})
    on conflict (event_id, lower(channel))
    do update set sold = excluded.sold, note = coalesce(excluded.note, concert_ticket_sales.note)`;
}

export async function removeTicketChannel(id: string): Promise<void> {
  await sql`delete from concert_ticket_sales where id = ${id}`;
}
