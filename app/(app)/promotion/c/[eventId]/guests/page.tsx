import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { CREW_KINDS, GUEST_KINDS, listGuests } from "@/lib/queries/guests";
import { getListingEvent } from "@/lib/queries/listings";
import { ticketSales } from "@/lib/queries/ticket-sales";
import { AddGuestRow, GuestRows, PasteListButton, StaffRows } from "../../../guest-rows";

export const metadata: Metadata = { title: "Guest list" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everyone coming to a concert: the guests (who, how many tickets) and, below,
 * the staff and artists (role, phone, call time). Both checked in at the door.
 */
export default async function GuestListPage({ params }: PageProps<"/promotion/c/[eventId]/guests">) {
  const { eventId: id } = await params;
  if (!UUID.test(id)) notFound();
  const [event, everyone, sales] = await Promise.all([getListingEvent(id), listGuests(id), ticketSales(id)]);
  if (!event) notFound();
  const when = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, weekday: "long", month: "long", day: "numeric" }).format(event.startsAt);
  const label = (kind: string) => GUEST_KINDS.find((k) => k.value === kind)?.label ?? kind;
  const crewAll = everyone.filter((g) => CREW_KINDS.includes(g.kind));
  // Backups are on call only: listed apart and left out of the count.
  const crew = crewAll.filter((g) => !g.backup);
  const backups = crewAll.filter((g) => g.backup);
  const guests = everyone.filter((g) => !CREW_KINDS.includes(g.kind) && g.kind !== "buyer").sort((a, b) => a.name.localeCompare(b.name));
  // Ticket buyers pasted from each channel's list (Eventbrite, PipTix…), by channel.
  const buyers = everyone.filter((g) => g.kind === "buyer");
  const byChannel = [...new Set(buyers.map((b) => b.source || "Tickets"))]
    .sort()
    .map((c) => ({ channel: c, rows: buyers.filter((b) => (b.source || "Tickets") === c).sort((a, b) => a.name.localeCompare(b.name)) }));
  const channels = [...new Set([...sales.map((s) => s.channel), "PipTix", ...byChannel.map((c) => c.channel)])];
  const tickets = guests.reduce((n, g) => n + g.tickets, 0);
  const guestKinds = GUEST_KINDS.filter((k) => !CREW_KINDS.includes(k.value)).map((k) => ({ value: k.value, label: k.label }));
  const crewKinds = GUEST_KINDS.filter((k) => CREW_KINDS.includes(k.value)).map((k) => ({ value: k.value, label: k.label }));
  const staffRow = (g: (typeof everyone)[number]) => ({
    id: g.id,
    contactId: g.contactId,
    name: g.name,
    kind: g.kind,
    kindLabel: label(g.kind),
    role: g.role,
    phone: g.phone,
    callTime: g.callTime,
    note: g.note,
    backup: g.backup,
    photoUrl: g.photoUrl ?? null,
    checkedIn: Boolean(g.checkedInAt),
  });
  const title = "mb-1.5 flex items-end justify-between gap-3 px-4 text-[13px] uppercase tracking-wide text-subtle md:px-0 md:text-xs md:font-medium";

  return (
    <>
      <PageHeader
        title="Guest list"
        description={[event.title, when, event.venue].filter(Boolean).join(" · ")}
        back={{ href: `/concerts/${event.id}`, label: event.title }}
      />
      <div className="flex flex-col gap-8 md:max-w-2xl">
        <a
          href={`/api/door-list/${event.id}`}
          download
          className="-mt-2 flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-brand px-4 text-[17px] font-semibold text-white active:opacity-90 md:min-h-11 md:rounded-lg md:text-sm"
        >
          <FileDown className="size-5" aria-hidden />
          Door list (PDF): everyone, A to Z
        </a>
        <section aria-label="Guests" className="flex flex-col gap-3">
          <h2 className={title}>
            <span>Guests</span>
            <span className="normal-case tracking-normal">
              {guests.length} · {tickets} tickets
              {guests.some((g) => g.checkedInAt) ? ` · ${guests.filter((g) => g.checkedInAt).reduce((n, g) => n + g.tickets, 0)} in` : ""}
            </span>
          </h2>
          {guests.length ? (
            <GuestRows
              guests={guests.map((g) => ({
                id: g.id,
                contactId: g.contactId,
                name: g.name,
                email: g.email,
                tickets: g.tickets,
                kindLabel: label(g.kind),
                note: g.note,
                photoUrl: g.photoUrl ?? null,
                checkedIn: Boolean(g.checkedInAt),
              }))}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[15px] text-muted md:rounded-lg md:text-sm">
              No guests yet. Add them from their email (one tap on the card) or search your contacts below.
            </p>
          )}
          <AddGuestRow eventId={event.id} kinds={guestKinds} />
        </section>

        <section aria-label="Ticket buyers" className="flex flex-col gap-3">
          <h2 className={title}>
            <span>Ticket buyers</span>
            <span className="normal-case tracking-normal">
              {buyers.length ? `${buyers.length} · ${buyers.reduce((n, b) => n + b.tickets, 0)} tickets` : "From each channel's list"}
            </span>
          </h2>
          {byChannel.map(({ channel, rows }) => (
            <div key={channel} className="flex flex-col gap-1.5">
              <p className="px-4 text-[13px] font-medium text-muted md:px-0 md:text-xs">
                {channel} · {rows.length} · {rows.reduce((n, b) => n + b.tickets, 0)} tickets
              </p>
              <GuestRows
                guests={rows.map((g) => ({
                  id: g.id,
                  contactId: g.contactId,
                  name: g.name,
                  email: g.email,
                  tickets: g.tickets,
                  kindLabel: channel,
                  note: g.note,
                  photoUrl: g.photoUrl ?? null,
                  checkedIn: Boolean(g.checkedInAt),
                }))}
              />
            </div>
          ))}
          <PasteListButton eventId={event.id} channels={channels} />
        </section>

        <section id="staff" aria-label="Staff and artists" className="flex scroll-mt-4 flex-col gap-3">
          <h2 className={title}>
            <span>Staff &amp; artists</span>
            <span className="normal-case tracking-normal">
              {crew.length}
              {crew.some((g) => g.checkedInAt) ? ` · ${crew.filter((g) => g.checkedInAt).length} in` : ""}
            </span>
          </h2>
          {crew.length ? (
            <StaffRows kinds={crewKinds} staff={crew.map(staffRow)} />
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[15px] text-muted md:rounded-lg md:text-sm">
              Musicians, crew, ushers, photographers: who works the concert, with their phone and call time.
            </p>
          )}
          {backups.length ? (
            <>
              <h3 className="-mb-1 mt-1 px-4 text-[13px] uppercase tracking-wide text-subtle md:px-0 md:text-xs md:font-medium">
                Backups · {backups.length} <span className="normal-case tracking-normal">(not counted)</span>
              </h3>
              <StaffRows kinds={crewKinds} staff={backups.map(staffRow)} />
            </>
          ) : null}
          <AddGuestRow eventId={event.id} kinds={crewKinds} mode="staff" />
        </section>
        <p className="-mt-4 px-4 text-[13px] text-subtle md:px-0 md:text-xs">At the door, tap the circle when someone arrives.</p>
      </div>
    </>
  );
}
