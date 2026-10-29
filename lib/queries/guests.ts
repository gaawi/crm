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
/** People who bought a ticket (pasted from the lists Eventbrite, PipTix... send), kept apart from the guests. */
export type GuestKind = (typeof GUEST_KINDS)[number]["value"] | "buyer";

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
  /** A stand-by (staff or artist): listed apart and not counted. */
  backup: boolean;
  /** Buyers: the channel their list came from (Eventbrite, PipTix…). */
  source: string | null;
  checkedInAt: Date | null;
  createdAt: Date;
  /** The contact's photo (listGuests only). */
  photoUrl?: string | null;
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
  /** Guests (staff and artists aside) and their tickets. */
  guests: number;
  tickets: number;
  /** Staff and artists, backups aside. */
  crew: number;
}

const guestColumns = sql`g.id, g.event_id, g.contact_id, g.name, g.email, g.tickets, g.kind, g.note, g.role, g.phone,
  to_char(g.call_time, 'HH24:MI') as call_time, g.backup, g.source, g.checked_in_at, g.created_at`;

/** Concerts still to come (one stays "to come" until its evening is over), soonest first, with their list totals. */
export async function upcomingGuestListEvents(now: Date = new Date()): Promise<GuestListEvent[]> {
  return sql<GuestListEvent[]>`
    select e.id, e.title, e.starts_at, e.time_zone, e.venue,
           (count(g.id) filter (where g.kind not in ('staff', 'artist', 'buyer')))::int as guests, coalesce(sum(g.tickets) filter (where g.kind not in ('staff', 'artist', 'buyer')), 0)::int as tickets,
           (count(g.id) filter (where g.kind in ('staff', 'artist') and not g.backup))::int as crew
      from listing_events e
      left join concert_guests g on g.event_id = e.id
     where e.starts_at >= ${new Date(now.getTime() - 6 * 3_600_000)}
     group by e.id
     order by e.starts_at`;
}

/** The upcoming concerts as the guest list pickers show them ("Oct 30", a calendar tile). */
export function pickerEvents(events: GuestListEvent[]) {
  const part = (e: GuestListEvent, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: e.timeZone, ...o }).format(e.startsAt);
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    when: part(e, { month: "short", day: "numeric" }),
    month: part(e, { month: "short" }),
    day: part(e, { day: "numeric" }),
  }));
}

export async function listGuests(eventId: string): Promise<ConcertGuest[]> {
  return sql<ConcertGuest[]>`
    select ${guestColumns}, (select c.photo_url from contacts c where c.id = g.contact_id) as photo_url
      from concert_guests g where g.event_id = ${eventId}
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
  backup?: boolean;
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
      insert into concert_guests (event_id, contact_id, name, email, tickets, kind, note, role, phone, call_time, backup)
      values (${input.eventId}, ${input.contactId}, ${name}, ${email}, ${tickets}, ${input.kind ?? "guest"}, ${input.note ?? null},
              ${input.role ?? null}, ${phone}, ${callTime}::time, ${input.backup ?? false})
      on conflict (event_id, contact_id) where contact_id is not null
      do update set tickets = case when ${input.tickets !== undefined} then excluded.tickets else concert_guests.tickets end,
                    kind = case when ${input.kind !== undefined} then excluded.kind else concert_guests.kind end,
                    note = coalesce(excluded.note, concert_guests.note),
                    role = coalesce(excluded.role, concert_guests.role),
                    phone = coalesce(excluded.phone, concert_guests.phone),
                    call_time = coalesce(excluded.call_time, concert_guests.call_time),
                    backup = case when ${input.backup !== undefined} then excluded.backup else concert_guests.backup end
      returning id`;
    return row.id;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into concert_guests (event_id, name, email, tickets, kind, note, role, phone, call_time, backup)
    values (${input.eventId}, ${name}, ${email}, ${tickets}, ${input.kind ?? "guest"}, ${input.note ?? null},
            ${input.role ?? null}, ${phone}, ${callTime}::time, ${input.backup ?? false})
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
    backup?: boolean;
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
      backup = coalesce(${patch.backup ?? null}::boolean, backup),
      name = coalesce(nullif(btrim(${patch.name ?? ""}), ''), name),
      checked_in_at = case when ${patch.checkedIn === undefined} then checked_in_at
                           when ${patch.checkedIn ?? false} then coalesce(checked_in_at, now()) else null end
     where id = ${id}`;
}

export async function removeGuest(id: string): Promise<string | null> {
  const [row] = await sql<{ eventId: string }[]>`delete from concert_guests where id = ${id} returning event_id`;
  return row?.eventId ?? null;
}

/**
 * A channel's ticket list pasted in (Eventbrite, PipTix…): its buyers join the
 * door list under that channel. With `replace`, that channel's earlier list is
 * swapped for this one (buyers already checked in at the door stay).
 */
export async function importBuyers(
  eventId: string,
  source: string,
  buyers: { name: string; email: string | null; tickets: number }[],
  replace: boolean,
): Promise<{ added: number; removed: number }> {
  const channel = source.trim().slice(0, 80);
  if (!channel) throw new Error("Pick where the list comes from.");
  if (!buyers.length) throw new Error("No names found in the list.");
  if (buyers.length > 2000) throw new Error("That list is too long (2000 names at most).");
  return sql.begin(async (tx) => {
    const removed = replace
      ? await tx`delete from concert_guests where event_id = ${eventId} and kind = 'buyer'
                 and lower(source) = lower(${channel}) and checked_in_at is null`
      : { count: 0 };
    const kept = await tx<{ name: string }[]>`
      select lower(name) as name from concert_guests where event_id = ${eventId} and kind = 'buyer' and lower(source) = lower(${channel})`;
    const seen = new Set(kept.map((k) => k.name));
    const fresh = buyers.filter((b) => {
      const key = b.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length) {
      await tx`
        insert into concert_guests ${tx(
          fresh.map((b) => ({ eventId, name: b.name, email: b.email, tickets: b.tickets, kind: "buyer", source: channel })),
          "eventId",
          "name",
          "email",
          "tickets",
          "kind",
          "source",
        )}`;
    }
    return { added: fresh.length, removed: removed.count };
  });
}
