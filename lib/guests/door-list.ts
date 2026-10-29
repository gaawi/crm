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
  const who = crew
    ? `${esc(g.role || WHO[g.kind] || "")}${g.callTime ? ` · ${clock(g.callTime)}` : ""}${g.backup ? " · backup" : ""}`
    : esc(g.kind === "buyer" ? g.source || "Ticket" : g.kind === "guest" ? "Guest list" : `Guest list · ${WHO[g.kind] ?? g.kind}`);
  return `<div class="row"><span class="box"></span><span class="name"><b>${esc(last)}</b>${first ? `, ${esc(first)}` : ""}</span>${
    crew ? "" : `<span class="tix">${g.tickets}</span>`
  }<span class="who">${who}</span></div>`;
}

/** Two narrow columns, a small letter heading where the last names change letter. */
function list(title: string, rows: ConcertGuest[], crew: boolean): string {
  if (!rows.length) return "";
  let body = "";
  let letter = "";
  for (const g of [...rows].sort(byLastName)) {
    const l = letterOf(g);
    if (l !== letter) {
      letter = l;
      body += `<div class="letter">${l}</div>`;
    }
    body += row(g, crew);
  }
  const tickets = rows.reduce((n, g) => n + g.tickets, 0);
  const count = crew ? `${rows.length}` : `${rows.length} names · ${tickets} tickets`;
  return `<section><h2>${esc(title)}<span>${count}</span></h2><div class="cols">${body}</div></section>`;
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
  body { font-family: Helvetica, Arial, sans-serif; color: #000; font-size: 11px; margin: 0; }
  header { border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  h1 { font-size: 16px; margin: 0; }
  header p { margin: 0; font-size: 10px; color: #333; text-align: right; }
  section { margin-bottom: 10px; }
  h2 { font-size: 12px; margin: 0 0 3px; display: flex; justify-content: space-between; border-bottom: 1.5px solid #000; padding-bottom: 1px; text-transform: uppercase; letter-spacing: .04em; }
  h2 span { font-weight: normal; text-transform: none; letter-spacing: 0; }
  .cols { column-count: 2; column-gap: 18px; column-rule: 1px solid #ddd; }
  .letter { font-size: 12px; font-weight: bold; background: #000; color: #fff; padding: 0 4px; margin: 4px 0 1px; break-after: avoid; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .row { display: flex; align-items: center; gap: 5px; padding: 2px 0; border-bottom: 1px solid #e2e2e2; break-inside: avoid; }
  .box { flex: none; width: 11px; height: 11px; border: 1.5px solid #000; border-radius: 2px; }
  .name { flex: 1; min-width: 0; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name b { text-transform: uppercase; }
  .tix { flex: none; width: 18px; text-align: center; font-weight: bold; font-size: 12px; }
  .who { flex: none; width: 34%; font-size: 9px; color: #444; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  footer { margin-top: 6px; color: #888; font-size: 8px; }
  </style></head><body>
  <header><h1>Door list · ${esc(event.title)}</h1><p>${esc(when)}${event.venue ? ` · ${esc(event.venue)}` : ""}<br><b>Audience: ${audience.length} names · ${admits} tickets${crew.length ? ` · Staff &amp; artists: ${crew.length}` : ""}</b></p></header>
  ${list("Audience", audience, false) || "<p>No one on the audience list yet.</p>"}
  ${list("Staff & artists", crew, true)}
  <footer>Printed ${esc(fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, generatedAt))} from Vela.</footer>
  </body></html>`;
}
