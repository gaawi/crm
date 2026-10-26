import { randomBytes } from "node:crypto";
import type { Address } from "@/lib/types";

const CRLF = "\r\n";
/** Soft limit for header lines (RFC 5322 §2.1.1). */
const MAX_LINE = 78;
/** "=?UTF-8?B?" + 60 base64 chars + "?=" = 72 ≤ 75 (RFC 2047 §2). 60 base64 chars = 45 bytes. */
const MAX_ENCODED_WORD_BYTES = 45;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** CR/LF (header injection) and other control characters become spaces; whitespace collapsed. */
export function cleanHeaderText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
}

/** An address as it may appear inside <…>: no whitespace, brackets or list separators. */
function cleanEmail(email: string): string {
  return String(email ?? "")
    .replace(/[\s<>(),;:"[\]\\]+/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "");
}

/** "<id>" form of a Message-ID (brackets added when missing), or null. */
function cleanMessageId(value: string | null | undefined): string | null {
  const text = cleanHeaderText(value);
  if (!text) return null;
  const bracketed = /<[^<>]+>/.exec(text);
  const inner = (bracketed ? bracketed[0].slice(1, -1) : text.replace(/^<+|>+$/g, "")).replace(/\s+/g, "");
  return inner ? `<${inner}>` : null;
}

/** Fold a header at spaces so lines stay ≤ 78 characters where possible. */
function foldHeader(name: string, value: string): string {
  const words = value.split(" ");
  const lines: string[] = [];
  let line = `${name}:`;
  for (const word of words) {
    if (word === "") continue;
    if (line.length + 1 + word.length > MAX_LINE && line.length > name.length + 1) {
      lines.push(line);
      line = ` ${word}`;
    } else {
      line += ` ${word}`;
    }
  }
  lines.push(line);
  return lines.join(CRLF);
}

function formatDate(date: Date): string {
  const d = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`
  );
}

function wrapBase64(value: string): string {
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += 76) lines.push(value.slice(i, i + 76));
  return lines.join(CRLF);
}

/**
 * Build an RFC 2822 message for users.drafts.create.
 * - UTF-8 text/plain body, Content-Transfer-Encoding: base64 (76-char lines).
 *   A body with **bold** words goes out as multipart/alternative: the plain
 *   text without the asterisks, plus a minimal HTML version with <strong>.
 * - Non-ASCII header values RFC 2047 encoded; display names quoted as needed.
 * - Header injection safe: CR/LF stripped from every header value.
 * - In-Reply-To / References set when replying (References = previous
 *   References + In-Reply-To target).
 * Returns the message as base64url (the `raw` field).
 */
export function buildRawMessage(params: {
  from: Address;
  to: Address[];
  cc?: Address[];
  /** Only for messages.send: Gmail delivers to Bcc and strips the header. */
  bcc?: Address[];
  subject: string;
  bodyText: string;
  inReplyTo?: string | null;
  references?: string | null;
  date?: Date;
}): string {
  const headers: string[] = [];
  headers.push(foldHeader("From", formatAddress(params.from)));

  const addressList = (list: Address[] | undefined) =>
    (list ?? [])
      .filter((address) => cleanEmail(address?.email ?? "") !== "")
      .map(formatAddress)
      .join(", ");
  const to = addressList(params.to);
  if (to) headers.push(foldHeader("To", to));
  const cc = addressList(params.cc);
  if (cc) headers.push(foldHeader("Cc", cc));
  const bcc = addressList(params.bcc);
  if (bcc) headers.push(foldHeader("Bcc", bcc));

  headers.push(foldHeader("Subject", encodeHeaderValue(cleanHeaderText(params.subject))));
  headers.push(`Date: ${formatDate(params.date ?? new Date())}`);

  const inReplyTo = cleanMessageId(params.inReplyTo);
  if (inReplyTo) {
    const previous = cleanHeaderText(params.references);
    const ids = previous.match(/<[^<>]+>/g) ?? previous.split(" ").filter(Boolean);
    const unique: string[] = [];
    for (const id of [...ids.map((i) => cleanMessageId(i)), inReplyTo]) {
      if (id && !unique.includes(id)) unique.push(id);
    }
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(foldHeader("References", unique.join(" ")));
  }

  headers.push("MIME-Version: 1.0");
  const text = String(params.bodyText ?? "");
  const encode = (value: string) => wrapBase64(Buffer.from(value.replace(/\r\n|\r|\n/g, CRLF), "utf8").toString("base64"));

  if (!hasBold(text)) {
    headers.push("Content-Type: text/plain; charset=UTF-8");
    headers.push("Content-Transfer-Encoding: base64");
    const message = `${headers.join(CRLF)}${CRLF}${CRLF}${encode(text)}${CRLF}`;
    return Buffer.from(message, "utf8").toString("base64url");
  }

  const boundary = `vela-${randomBytes(12).toString("hex")}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const part = (type: string, value: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", encode(value)].join(CRLF);
  const message = [headers.join(CRLF), "", part("text/plain", stripBold(text)), part("text/html", boldHtml(text)), `--${boundary}--`, ""].join(CRLF);
  return Buffer.from(message, "utf8").toString("base64url");
}

const BOLD = /\*\*([^*\n]+?)\*\*/g;

/** The body marks words to stress with **double asterisks** (one line at most). */
export function hasBold(text: string): boolean {
  return /\*\*[^*\n]+?\*\*/.test(text);
}

/** The plain-text part: the same words, without the asterisks. */
export function stripBold(text: string): string {
  return text.replace(BOLD, "$1");
}

/** A plain email as minimal HTML: paragraphs, line breaks and <strong> for **bold**. */
export function boldHtml(text: string): string {
  const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const paragraphs = text
    .replace(/\r\n|\r/g, "\n")
    .split(/\n{2,}/)
    .map((p) => `<p>${escape(p).replace(BOLD, "<strong>$1</strong>").replace(/\n/g, "<br>")}</p>`);
  return `<div dir="ltr">${paragraphs.join("")}</div>`;
}

/** "Re: Hello" stays; "Hello" → "Re: Hello"; handles "RE:", "Fwd:" prefixes sensibly. */
export function replySubject(subject: string | null): string {
  const text = cleanHeaderText(subject);
  if (!text) return "";
  // An existing reply prefix is kept as written (Re:, RE:, Aw:, Réf:, …).
  if (/^(?:re|aw|réf|ref|sv|antw|rif)\s*(?:\[\d+\])?\s*:/i.test(text)) return text;
  const rest = text.replace(/^(?:(?:fwd?|fw|tr|wg)\s*:\s*)+/i, "").trim();
  if (/^(?:re|aw|réf|ref|sv|antw|rif)\s*(?:\[\d+\])?\s*:/i.test(rest)) return rest;
  return rest ? `Re: ${rest}` : "Re:";
}

/** RFC 2047 B-encode a header value if it contains non-ASCII characters. */
export function encodeHeaderValue(value: string): string {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ");
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E\t]*$/.test(text)) return text;

  const words: string[] = [];
  let chunk: Buffer[] = [];
  let size = 0;
  const flush = () => {
    if (size === 0) return;
    words.push(`=?UTF-8?B?${Buffer.concat(chunk).toString("base64")}?=`);
    chunk = [];
    size = 0;
  };
  // Code point by code point, so a character is never split across two words.
  for (const char of text) {
    const bytes = Buffer.from(char, "utf8");
    if (size + bytes.length > MAX_ENCODED_WORD_BYTES) flush();
    chunk.push(bytes);
    size += bytes.length;
  }
  flush();
  return words.join(" ");
}

/** Format an address for a header: `"Doe, Jane" <jane@x.com>` / `jane@x.com`. */
export function formatAddress(address: Address): string {
  const email = cleanEmail(address?.email ?? "");
  const name = cleanHeaderText(address?.name);
  if (!name || name.toLowerCase() === email.toLowerCase()) return email;
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7E]*$/.test(name)) return `${encodeHeaderValue(name)} <${email}>`;
  if (/[,;:<>@"()[\]\\.]/.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
  return `${name} <${email}>`;
}
