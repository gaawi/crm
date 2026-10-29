import type { ConcertGuest } from "@/lib/queries/guests";

/**
 * The door list of a concert as a printable page (made into a PDF): everyone
 * who gets in, by section (guests, ticket buyers per channel, staff and
 * artists, backups), alphabetical, with a box to tick at the door.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const byName = (a: ConcertGuest, b: ConcertGuest) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/** "17:00" as "5:00 PM". */
function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const KIND_LABEL: Record<string, string> = { guest: "Guest", press: "Press", partner: "Partner", staff: "Staff", artist: "Artist" };

interface Section {
  title: string;
  rows: ConcertGuest[];
  /** Show tickets (guests, buyers) or call time and role (staff). */
  crew?: boolean;
}

export function doorListHtml(
  event: { title: string; startsAt: Date; timeZone: string; venue: string | null },
  everyone: ConcertGuest[],
  generatedAt: Date = new Date(),
): string {
  const crew = everyone.filter((g) => g.kind === "staff" || g.kind === "artist");
  const buyers = everyone.filter((g) => g.kind === "buyer");
  const guests = everyone.filter((g) => !crew.includes(g) && !buyers.includes(g));
  // At the door names are looked up, not channels: one list A to Z, the channel in its own column.
  const sections: Section[] = [
    { title: "Everyone at the door (A to Z)", rows: [...guests, ...buyers].sort(byName) },
    { title: "Staff & artists", rows: crew.filter((g) => !g.backup).sort(byName), crew: true },
    { title: "Backups (only if needed)", rows: crew.filter((g) => g.backup).sort(byName), crew: true },
  ].filter((s) => s.rows.length);

  const fmt = (o: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, ...o }).format(d);
  const when = fmt({ weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }, event.startsAt);
  const admits = [...guests, ...buyers].reduce((n, g) => n + g.tickets, 0);
  const people = guests.length + buyers.length;
  // Per channel: how many names and tickets (to check against each list).
  const typeOf = (g: ConcertGuest) => (g.kind === "buyer" ? g.source || "Ticket" : "Guest list");
  const perType = [...new Set([...guests, ...buyers].map(typeOf))]
    .sort((a, b) => (a === "Guest list" ? -1 : b === "Guest list" ? 1 : a.localeCompare(b)))
    .map((t) => {
      const rows = [...guests, ...buyers].filter((g) => typeOf(g) === t);
      return `${esc(t)}: ${rows.length} · ${rows.reduce((n, g) => n + g.tickets, 0)} tix`;
    });

  const table = (s: Section) => {
    const tickets = s.rows.reduce((n, g) => n + g.tickets, 0);
    const head = s.crew
      ? `<tr><th class="box"></th><th>Name</th><th>Role</th><th class="num">Call</th><th>Phone</th></tr>`
      : `<tr><th class="box"></th><th>Name</th><th class="num">Tickets</th><th>Type</th><th>Note</th></tr>`;
    const body = s.rows
      .map((g) =>
        s.crew
          ? `<tr><td class="box"><span></span></td><td class="name">${esc(g.name)}</td><td>${esc(g.role || KIND_LABEL[g.kind] || "")}</td><td class="num">${g.callTime ? clock(g.callTime) : ""}</td><td>${esc(g.phone || "")}</td></tr>`
          : `<tr><td class="box"><span></span></td><td class="name">${esc(g.name)}</td><td class="num">${g.tickets}</td><td>${esc(g.kind === "buyer" ? g.source || "Ticket" : `Guest list${g.kind !== "guest" ? ` (${KIND_LABEL[g.kind] ?? g.kind})` : ""}`)}</td><td>${esc(g.note || "")}</td></tr>`,
      )
      .join("");
    const count = s.crew ? `${s.rows.length}` : `${s.rows.length} ${s.rows.length === 1 ? "name" : "names"} · ${tickets} ${tickets === 1 ? "ticket" : "tickets"}`;
    return `<section><h2>${esc(s.title)}<span>${count}</span></h2><table><thead>${head}</thead><tbody>${body}</tbody></table></section>`;
  };

  return `<!doctype html><html><head><meta charset="utf-8"><title>Door list · ${esc(event.title)}</title><style>
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 11px; margin: 0; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  header p { margin: 0; color: #444; font-size: 11.5px; }
  header .total { margin-top: 6px; font-weight: bold; color: #111; }
  header .by { margin-top: 2px; font-size: 10px; color: #555; }
  section { margin-bottom: 14px; }
  h2 { font-size: 13px; margin: 0 0 4px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #999; padding-bottom: 2px; }
  h2 span { font-size: 10.5px; font-weight: normal; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #666; font-weight: normal; padding: 2px 4px; }
  td { padding: 4px 4px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .box { width: 18px; }
  .box span { display: inline-block; width: 11px; height: 11px; border: 1.2px solid #333; border-radius: 2px; }
  .name { font-weight: bold; font-size: 11.5px; }
  .num { text-align: right; width: 52px; white-space: nowrap; }
  footer { margin-top: 10px; color: #888; font-size: 9px; }
  </style></head><body>
  <header><h1>Door list · ${esc(event.title)}</h1><p>${esc(when)}${event.venue ? ` · ${esc(event.venue)}` : ""}</p>
  <p class="total">${people} ${people === 1 ? "name" : "names"} · ${admits} ${admits === 1 ? "admission" : "admissions"}${crew.length ? ` · plus ${crew.filter((g) => !g.backup).length} staff & artists` : ""}</p>
  ${perType.length ? `<p class="by">${perType.join(" &nbsp;|&nbsp; ")}</p>` : ""}</header>
  ${sections.length ? sections.map(table).join("") : "<p>No one on the list yet.</p>"}
  <footer>Printed ${esc(fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, generatedAt))} from Vela.</footer>
  </body></html>`;
}
