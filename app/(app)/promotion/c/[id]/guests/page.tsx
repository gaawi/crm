import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/layout";
import { GUEST_KINDS, listGuests } from "@/lib/queries/guests";
import { getListingEvent } from "@/lib/queries/listings";
import { AddGuestRow, GuestRows } from "../../../guest-rows";

export const metadata: Metadata = { title: "Guest list" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A concert's guest (door) list: who, how many tickets, and who has arrived. */
export default async function GuestListPage({ params }: PageProps<"/promotion/c/[id]/guests">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [event, guests] = await Promise.all([getListingEvent(id), listGuests(id)]);
  if (!event) notFound();
  const when = new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, weekday: "long", month: "long", day: "numeric" }).format(event.startsAt);
  const tickets = guests.reduce((n, g) => n + g.tickets, 0);
  const arrived = guests.filter((g) => g.checkedInAt);
  const label = (kind: string) => GUEST_KINDS.find((k) => k.value === kind)?.label ?? kind;

  return (
    <>
      <PageHeader
        title="Guest list"
        description={[event.title, when, event.venue].filter(Boolean).join(" · ")}
        back={event.promote ? { href: `/promotion/c/${event.id}`, label: event.title } : { href: "/promotion", label: "Promotion" }}
      />
      <div className="flex flex-col gap-4 md:max-w-2xl">
        <p className="flex flex-wrap gap-x-4 px-4 text-[15px] text-muted md:px-0 md:text-sm">
          <span>
            <span className="font-semibold text-fg tabular-nums">{guests.length}</span> {guests.length === 1 ? "person" : "people"}
          </span>
          <span>
            <span className="font-semibold text-fg tabular-nums">{tickets}</span> tickets
          </span>
          {arrived.length ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              <span className="font-semibold tabular-nums">{arrived.reduce((n, g) => n + g.tickets, 0)}</span> in
            </span>
          ) : null}
        </p>
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
              checkedIn: Boolean(g.checkedInAt),
            }))}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[15px] text-muted md:rounded-lg md:text-sm">
            Nobody yet. Add people from their email in Mail (one tap on their card), or search your contacts below.
          </p>
        )}
        <AddGuestRow eventId={event.id} kinds={GUEST_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <p className="px-4 text-[13px] text-subtle md:px-0 md:text-xs">At the door, tap the circle when someone arrives.</p>
      </div>
    </>
  );
}
