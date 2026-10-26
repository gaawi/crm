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
  /** Staff and artists: what they do, a phone for the day, and the time they were told to arrive ("17:00"). */
  role: string | null;
  phone: string | null;
  callTime: string | null;
  checkedInAt: Date | null;
  createdAt: Date;
}

/** Staff and artists are listed apart from the guests (with role, phone and call time). */
export const CREW_KINDS: GuestKind[] = ["staff", "artist"];

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

const guestColumns = sql`g.id, g.event_id, g.contact_id, g.name, g.email, g.tickets, g.kind, g.note, g.role, g.phone,
  to_char(g.call_time, 'HH24:MI') as call_time, g.checked_in_at, g.created_at`;

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
     order by g.call_time nulls last, lower(g.name), g.created_at`;
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
  role?: string | null;
  phone?: string | null;
  /** "HH:MM" */
  callTime?: string | null;
}

/**
 * Put someone on a concert's list. A contact already on it keeps their row
 * (only the fields given change). The name, address and phone of a contact
 * come from the CRM unless given.
 */
export async function addGuest(input: GuestInput): Promise<string> {
  let name = input.name.trim();
  let email = input.email?.trim().toLowerCase() || null;
  let phone = input.phone?.trim() || null;
  if (input.contactId) {
    const [contact] = await sql<{ name: string | null; email: string | null; phone: string | null }[]>`
      select nullif(btrim(c.name), '') as name, c.phone,
             (select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1) as email
        from contacts c where c.id = ${input.contactId}`;
    if (!contact) throw new Error("That contact no longer exists.");
    name = name || contact.name || contact.email || "";
    email = email ?? contact.email;
    phone = phone ?? contact.phone;
  }
  const callTime = input.callTime?.trim() || null;
  if (callTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(callTime)) throw new Error("Give the call time as HH:MM.");
  if (!name) throw new Error("Give the guest a name.");
  const tickets = input.tickets ?? 2;
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > 20) throw new Error("Tickets go from 1 to 20.");
  if (input.contactId) {
    const [row] = await sql<{ id: string }[]>`
      insert into concert_guests (event_id, contact_id, name, email, tickets, kind, note, role, phone, call_time)
      values (${input.eventId}, ${input.contactId}, ${name}, ${email}, ${tickets}, ${input.kind ?? "guest"}, ${input.note ?? null},
              ${input.role ?? null}, ${phone}, ${callTime}::time)
      on conflict (event_id, contact_id) where contact_id is not null
      do update set tickets = case when ${input.tickets !== undefined} then excluded.tickets else concert_guests.tickets end,
                    kind = case when ${input.kind !== undefined} then excluded.kind else concert_guests.kind end,
                    note = coalesce(excluded.note, concert_guests.note),
                    role = coalesce(excluded.role, concert_guests.role),
                    phone = coalesce(excluded.phone, concert_guests.phone),
                    call_time = coalesce(excluded.call_time, concert_guests.call_time)
      returning id`;
    return row.id;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into concert_guests (event_id, name, email, tickets, kind, note, role, phone, call_time)
    values (${input.eventId}, ${name}, ${email}, ${tickets}, ${input.kind ?? "guest"}, ${input.note ?? null},
            ${input.role ?? null}, ${phone}, ${callTime}::time)
    returning id`;
  return row.id;
}

export async function updateGuest(
  id: string,
  patch: {
    tickets?: number;
    kind?: GuestKind;
    note?: string | null;
    name?: string;
    checkedIn?: boolean;
    role?: string | null;
    phone?: string | null;
    callTime?: string | null;
  },
): Promise<void> {
  if (patch.callTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.callTime)) throw new Error("Give the call time as HH:MM.");
  if (patch.tickets !== undefined && (!Number.isInteger(patch.tickets) || patch.tickets < 1 || patch.tickets > 20)) {
    throw new Error("Tickets go from 1 to 20.");
  }
  await sql`
    update concert_guests set
      tickets = coalesce(${patch.tickets ?? null}::smallint, tickets),
      kind = coalesce(${patch.kind ?? null}, kind),
      note = case when ${patch.note !== undefined} then ${patch.note ?? null} else note end,
      role = case when ${patch.role !== undefined} then ${patch.role ?? null} else role end,
      phone = case when ${patch.phone !== undefined} then ${patch.phone ?? null} else phone end,
      call_time = case when ${patch.callTime !== undefined} then ${patch.callTime ?? null}::time else call_time end,
      name = coalesce(nullif(btrim(${patch.name ?? ""}), ''), name),
      checked_in_at = case when ${patch.checkedIn === undefined} then checked_in_at
                           when ${patch.checkedIn ?? false} then coalesce(checked_in_at, now()) else null end
     where id = ${id}`;
}

export async function removeGuest(id: string): Promise<string | null> {
  const [row] = await sql<{ eventId: string }[]>`delete from concert_guests where id = ${id} returning event_id`;
  return row?.eventId ?? null;
}
