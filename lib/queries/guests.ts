import "server-only";
import { sql } from "@/lib/db";

/**
 * Guest (door) lists of the concerts (concert_guests): who gets in for free
 * and with how many tickets. A contact is on a concert's list at most once;
 * people outside the CRM go by name.
 */

export const GUEST_KINDS = [
  { value: "guest", label: "Guest" },
  { value: "staff", label: "Staff" },
  { value: "artist", label: "Artist" },
  { value: "press", label: "Press" },
  { value: "partner", label: "Partner" },
] as const;
export type GuestKind = (typeof GUEST_KINDS)[number]["value"];

export interface ConcertGuest {
  id: string;
  eventId: string;
  contactId: string | null;
  name: string;
  email: string | null;
  tickets: number;
  kind: GuestKind;
  note: string | null;
  checkedInAt: Date | null;
  createdAt: Date;
}

/** A concert with its guest list size, for the pickers. */
export interface GuestListEvent {
  id: string;
  title: string;
  startsAt: Date;
  timeZone: string;
  venue: string | null;
  guests: number;
  tickets: number;
}

const guestColumns = sql`g.id, g.event_id, g.contact_id, g.name, g.email, g.tickets, g.kind, g.note, g.checked_in_at, g.created_at`;

/** Concerts still to come (one stays "to come" until its evening is over), soonest first, with their list totals. */
export async function upcomingGuestListEvents(now: Date = new Date()): Promise<GuestListEvent[]> {
  return sql<GuestListEvent[]>`
    select e.id, e.title, e.starts_at, e.time_zone, e.venue,
           count(g.id)::int as guests, coalesce(sum(g.tickets), 0)::int as tickets
      from listing_events e
      left join concert_guests g on g.event_id = e.id
     where e.starts_at >= ${new Date(now.getTime() - 6 * 3_600_000)}
     group by e.id
     order by e.starts_at`;
}

export async function listGuests(eventId: string): Promise<ConcertGuest[]> {
  return sql<ConcertGuest[]>`
    select ${guestColumns} from concert_guests g where g.event_id = ${eventId}
     order by lower(g.name), g.created_at`;
}

/** This contact's places on guest lists, by concert. */
export async function guestEntriesForContact(contactId: string): Promise<ConcertGuest[]> {
  return sql<ConcertGuest[]>`select ${guestColumns} from concert_guests g where g.contact_id = ${contactId}`;
}

export interface GuestInput {
  eventId: string;
  contactId?: string | null;
  name: string;
  email?: string | null;
  tickets?: number;
  kind?: GuestKind;
  note?: string | null;
}

/**
 * Put someone on a concert's list. A contact already on it keeps their row
 * (its tickets change only when `tickets` is given). The name and address of
 * a contact come from the CRM.
 */
export async function addGuest(input: GuestInput): Promise<string> {
  let name = input.name.trim();
  let email = input.email?.trim().toLowerCase() || null;
  if (input.contactId) {
    const [contact] = await sql<{ name: string | null; email: string | null }[]>`
      select nullif(btrim(c.name), '') as name,
             (select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1) as email
        from contacts c where c.id = ${input.contactId}`;
    if (!contact) throw new Error("That contact no longer exists.");
    name = name || contact.name || contact.email || "";
    email = email ?? contact.email;
  }
  if (!name) throw new Error("Give the guest a name.");
  const tickets = input.tickets ?? 2;
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > 20) throw new Error("Tickets go from 1 to 20.");
  if (input.contactId) {
    const [row] = await sql<{ id: string }[]>`
      insert into concert_guests (event_id, contact_id, name, email, tickets, kind, note)
      values (${input.eventId}, ${input.contactId}, ${name}, ${email}, ${tickets}, ${input.kind ?? "guest"}, ${input.note ?? null})
      on conflict (event_id, contact_id) where contact_id is not null
      do update set tickets = case when ${input.tickets !== undefined} then excluded.tickets else concert_guests.tickets end
      returning id`;
    return row.id;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into concert_guests (event_id, name, email, tickets, kind, note)
    values (${input.eventId}, ${name}, ${email}, ${tickets}, ${input.kind ?? "guest"}, ${input.note ?? null})
    returning id`;
  return row.id;
}

export async function updateGuest(
  id: string,
  patch: { tickets?: number; kind?: GuestKind; note?: string | null; name?: string; checkedIn?: boolean },
): Promise<void> {
  if (patch.tickets !== undefined && (!Number.isInteger(patch.tickets) || patch.tickets < 1 || patch.tickets > 20)) {
    throw new Error("Tickets go from 1 to 20.");
  }
  await sql`
    update concert_guests set
      tickets = coalesce(${patch.tickets ?? null}::smallint, tickets),
      kind = coalesce(${patch.kind ?? null}, kind),
      note = case when ${patch.note !== undefined} then ${patch.note ?? null} else note end,
      name = coalesce(nullif(btrim(${patch.name ?? ""}), ''), name),
      checked_in_at = case when ${patch.checkedIn === undefined} then checked_in_at
                           when ${patch.checkedIn ?? false} then coalesce(checked_in_at, now()) else null end
     where id = ${id}`;
}

export async function removeGuest(id: string): Promise<string | null> {
  const [row] = await sql<{ eventId: string }[]>`delete from concert_guests where id = ${id} returning event_id`;
  return row?.eventId ?? null;
}
