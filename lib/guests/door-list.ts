import type { ConcertGuest } from "@/lib/queries/guests";

/**
 * The door list of a concert as a printable page (made into a PDF), for the
 * person at the door: the audience (guests and ticket buyers of every channel
 * together) and, apart, the staff and artists. Each list by last name, under
 * big letters to jump to, the last name first and large, the tickets, who
 * they are and where they come from, and a box to tick when they arrive.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "Ana María López" → ["López", "Ana María"]; "López, Ana" → ["López", "Ana"]; one word → [it, ""]. */
export function splitName(name: string): [last: string, first: string] {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.includes(",")) {
    const [last, ...rest] = clean.split(",");
    return [last.trim(), rest.join(",").trim()];
  }
  const words = clean.split(" ");
  if (words.length < 2 || clean.includes("@")) return [clean, ""];
  return [words[words.length - 1], words.slice(0, -1).join(" ")];
}

const compare = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
const byLastName = (a: ConcertGuest, b: ConcertGuest) => {
  const [al, af] = splitName(a.name);
  const [bl, bf] = splitName(b.name);
  return compare(al, bl) || compare(af, bf);
};

/** The letter a name is filed under (accents folded: "Ávila" under A). */
const letterOf = (g: ConcertGuest) => {
  const c = splitName(g.name)[0].normalize("NFD").replace(/\p{M}/gu, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
};

/** "17:00" as "5:00 PM". */
function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const WHO: Record<string, string> = { guest: "Guest", press: "Press", partner: "Partner", buyer: "Audience", staff: "Staff", artist: "Artist" };

function row(g: ConcertGuest, crew: boolean): string {
  const [last, first] = splitName(g.name);
  const who = crew ? `${esc(g.role || WHO[g.kind] || "")}${g.backup ? ' <b class="backup">BACKUP</b>' : ""}` : esc(WHO[g.kind] ?? g.kind);
  const from = crew
    ? `${g.callTime ? `Call ${clock(g.callTime)}` : ""}${g.phone ? `<br><span class="small">${esc(g.phone)}</span>` : ""}`
    : esc(g.kind === "buyer" ? g.source || "Ticket" : "Guest list");
  const note = g.note ? `<div class="note">${esc(g.note)}</div>` : "";
  return `<tr><td class="box"><span></span></td><td class="name"><span class="last">${esc(last)}</span>${first ? `, <span class="first">${esc(first)}</span>` : ""}${note}</td>${
    crew ? "" : `<td class="tix">${g.tickets}</td>`
  }<td class="who">${who}</td><td class="from">${from}</td></tr>`;
}

function list(title: string, rows: ConcertGuest[], crew: boolean): string {
  if (!rows.length) return "";
  const sorted = [...rows].sort(byLastName);
  const head = `<tr><th class="box"></th><th>Last name, first name</th>${crew ? "" : '<th class="tix">Tickets</th>'}<th>${crew ? "Role" : "Who"}</th><th>${crew ? "Call time / phone" : "From"}</th></tr>`;
  let body = "";
  let letter = "";
  for (const g of sorted) {
    const l = letterOf(g);
    if (l !== letter) {
      letter = l;
      body += `<tr class="letter"><td colspan="${crew ? 4 : 5}">${l}</td></tr>`;
    }
    body += row(g, crew);
  }
  const tickets = rows.reduce((n, g) => n + g.tickets, 0);
  const count = crew ? `${rows.length} ${rows.length === 1 ? "person" : "people"}` : `${rows.length} ${rows.length === 1 ? "name" : "names"} · ${tickets} tickets`;
  return `<section><h2>${esc(title)}<span>${count}</span></h2><table><thead>${head}</thead><tbody>${body}</tbody></table></section>`;
}

export function doorListHtml(
  event: { title: string; startsAt: Date; timeZone: string; venue: string | null },
  everyone: ConcertGuest[],
  generatedAt: Date = new Date(),
): string {
  const crew = everyone.filter((g) => g.kind === "staff" || g.kind === "artist");
  const audience = everyone.filter((g) => !crew.includes(g));
  const fmt = (o: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone, ...o }).format(d);
  const when = fmt({ weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }, event.startsAt);
  const admits = audience.reduce((n, g) => n + g.tickets, 0);

  return `<!doctype html><html><head><meta charset="utf-8"><title>Door list · ${esc(event.title)}</title><style>
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #000; font-size: 13px; margin: 0; }
  header { border-bottom: 3px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 24px; margin: 0 0 2px; }
  header p { margin: 0; font-size: 13px; color: #333; }
  header .total { margin-top: 6px; font-size: 15px; font-weight: bold; color: #000; }
  section { margin-bottom: 18px; }
  section + section { page-break-before: always; }
  h2 { font-size: 18px; margin: 0 0 4px; display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #000; padding-bottom: 3px; text-transform: uppercase; letter-spacing: .03em; }
  h2 span { font-size: 13px; font-weight: normal; text-transform: none; letter-spacing: 0; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #444; font-weight: normal; padding: 3px 6px; }
  td { padding: 7px 6px; border-bottom: 1px solid #ccc; vertical-align: middle; }
  tr { page-break-inside: avoid; }
  tr.letter td { font-size: 22px; font-weight: bold; padding: 10px 6px 2px; border-bottom: 2px solid #000; page-break-after: avoid; }
  .box { width: 30px; }
  .box span { display: inline-block; width: 18px; height: 18px; border: 2px solid #000; border-radius: 3px; vertical-align: middle; }
  .name { font-size: 16px; }
  .last { font-weight: bold; font-size: 17px; text-transform: uppercase; }
  .first { font-weight: normal; }
  .note { font-size: 11px; color: #444; margin-top: 1px; }
  .tix { width: 64px; text-align: center; font-size: 20px; font-weight: bold; }
  th.tix { font-size: 10px; font-weight: normal; }
  .who { width: 110px; font-size: 13px; }
  .from { width: 170px; font-size: 13px; color: #222; }
  .small { font-size: 11px; color: #444; }
  .backup { font-size: 10px; border: 1px solid #000; padding: 0 3px; border-radius: 2px; }
  footer { margin-top: 10px; color: #777; font-size: 9px; }
  </style></head><body>
  <header><h1>Door list · ${esc(event.title)}</h1><p>${esc(when)}${event.venue ? ` · ${esc(event.venue)}` : ""}</p>
  <p class="total">Audience: ${audience.length} ${audience.length === 1 ? "name" : "names"} · ${admits} tickets${crew.length ? ` &nbsp;·&nbsp; Staff &amp; artists: ${crew.length}` : ""}</p></header>
  ${list("Audience", audience, false) || "<p>No one on the audience list yet.</p>"}
  ${list("Staff & artists", crew, true)}
  <footer>Printed ${esc(fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, generatedAt))} from Vela.</footer>
  </body></html>`;
}
