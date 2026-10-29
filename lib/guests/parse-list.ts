/**
 * A ticket list pasted from Eventbrite, PipTix, TDF... (copied from their
 * email, page or spreadsheet): one buyer per line, the name with optionally
 * an email and the number of tickets, separated by tabs, commas or semicolons
 * ("Ana López, 2", "López\tAna\tana@x.com\t3", "Ana López x2"). Header lines
 * ("Name", "First name, Last name, Qty") are skipped.
 */

export interface ParsedBuyer {
  name: string;
  email: string | null;
  tickets: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER = /^(first|last|full)?\s*name$|^(qty|quantity|tickets?|email|e-mail|order|#)$/i;
const MAX_TICKETS = 20;

export function parseBuyerList(text: string): ParsedBuyer[] {
  const buyers: ParsedBuyer[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, "").trim()).filter(Boolean);
    if (cells.every((c) => HEADER.test(c))) continue;
    let email: string | null = null;
    let tickets: number | null = null;
    const words: string[] = [];
    for (const cell of cells) {
      if (!email && EMAIL.test(cell)) {
        email = cell.toLowerCase();
        continue;
      }
      // "2", "x2", "2x", "2 tickets", "Qty: 2"
      const qty = cell.match(/^(?:qty:?\s*)?x?\s*(\d{1,3})\s*(?:x|tickets?|tix|pax)?$/i);
      if (tickets === null && qty) {
        tickets = Number(qty[1]);
        continue;
      }
      // A trailing "x2" / "(2)" on the name itself.
      const tail = cell.match(/^(.*?)\s+(?:x\s*(\d{1,3})|\((\d{1,3})\))$/i);
      if (tickets === null && tail) {
        tickets = Number(tail[2] ?? tail[3]);
        words.push(tail[1]);
        continue;
      }
      if (/\p{L}/u.test(cell)) words.push(cell);
    }
    const name = words.join(" ").replace(/\s+/g, " ").trim();
    if (!name && !email) continue;
    buyers.push({
      name: (name || email!).slice(0, 200),
      email,
      tickets: Math.min(Math.max(tickets ?? 1, 1), MAX_TICKETS),
    });
  }
  return buyers;
}
