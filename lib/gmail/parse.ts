import type { Address } from "@/lib/types";
import type { GmailHeader, GmailMessage, GmailMessagePart, ParsedMessage } from "@/lib/gmail/types";

/** Pure functions: Gmail API message → ParsedMessage. No I/O. */

export const MAX_BODY_CHARS = 20_000;
/** Automated mail keeps a short body (a human reply sent through a marketing tool still shows). */
export const MAX_AUTOMATED_BODY_CHARS = 500;
/** Header-derived strings (subject, Message-ID, References, names) are truncated to this. */
export const MAX_HEADER_CHARS = 2_000;

/** Gmail system labels whose messages are not imported (when not already stored). */
export const EXCLUDED_LABELS = ["SPAM", "TRASH", "DRAFT", "CHAT", "SCHEDULED"] as const;

/** Message-ID / In-Reply-To are indexed; keep them well under the btree row limit. */
const MAX_MESSAGE_ID_CHARS = 900;
const MAX_SNIPPET_CHARS = 500;
const MAX_EMAIL_CHARS = 320;
/** Work limits before quote stripping (the stored body is capped far lower anyway). */
const MAX_TEXT_INPUT_CHARS = 500_000;
const MAX_HTML_INPUT_CHARS = 2_000_000;
const MAX_MIME_DEPTH = 40;

const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;

/* ------------------------------------------------------------------------ */
/* Labels & queries                                                         */
/* ------------------------------------------------------------------------ */

/** "promotions" → "CATEGORY_PROMOTIONS" */
export function categoryLabel(category: string): string {
  const name = String(category)
    .trim()
    .toUpperCase()
    .replace(/^CATEGORY[_:]/, "");
  return `CATEGORY_${name}`;
}

/**
 * True when a message with these labels must not be stored: any EXCLUDED_LABELS,
 * or a CATEGORY_* label for one of skipCategories.
 */
export function shouldSkipLabels(labelIds: readonly string[], skipCategories: readonly string[]): boolean {
  const labels = new Set(labelIds ?? []);
  if (EXCLUDED_LABELS.some((label) => labels.has(label))) return true;
  return (skipCategories ?? []).some((category) => category.trim() !== "" && labels.has(categoryLabel(category)));
}

/**
 * Gmail search query for the historical import that mirrors shouldSkipLabels:
 * "-in:chats -in:drafts -category:promotions -category:social" + extra.
 * (Spam/trash are excluded by includeSpamTrash=false.)
 */
export function buildBackfillQuery(skipCategories: readonly string[], extra?: string): string {
  let query = "-in:chats -in:drafts";
  for (const category of skipCategories ?? []) {
    const name = category.trim().toLowerCase();
    if (name) query += ` -category:${name}`;
  }
  const more = extra?.trim();
  if (more) query += ` ${more}`;
  return query;
}

/* ------------------------------------------------------------------------ */
/* Headers                                                                  */
/* ------------------------------------------------------------------------ */

/** Case-insensitive header lookup (first match). */
export function getHeader(headers: GmailHeader[] | undefined, name: string): string | null {
  if (!Array.isArray(headers)) return null;
  const target = name.toLowerCase();
  for (const header of headers) {
    if (header && typeof header.name === "string" && header.name.trim().toLowerCase() === target) {
      return typeof header.value === "string" ? header.value : "";
    }
  }
  return null;
}

/** Every value of a header (case-insensitive), in order. */
function getHeaders(headers: GmailHeader[] | undefined, name: string): string[] {
  if (!Array.isArray(headers)) return [];
  const target = name.toLowerCase();
  const values: string[] = [];
  for (const header of headers) {
    if (header && typeof header.name === "string" && header.name.trim().toLowerCase() === target) {
      if (typeof header.value === "string") values.push(header.value);
    }
  }
  return values;
}

/** A parameter of a structured header, e.g. charset from Content-Type. */
function headerParam(value: string | null, param: string): string | null {
  if (!value) return null;
  const re = new RegExp(`(?:^|;)\\s*${param}\\*?\\s*=\\s*(?:"([^"]*)"|([^;\\s]*))`, "i");
  const match = re.exec(value);
  if (!match) return null;
  const result = (match[1] ?? match[2] ?? "").trim();
  return result || null;
}

/* ------------------------------------------------------------------------ */
/* Charsets & RFC 2047                                                      */
/* ------------------------------------------------------------------------ */

/** Lower-cased TextDecoder label; null means "unknown / ASCII: sniff utf-8, else windows-1252". */
function normalizeCharset(charset: string | null | undefined): string | null {
  if (!charset) return null;
  let label = charset.trim().toLowerCase().replace(/^["']|["']$/g, "");
  // RFC 2231 language suffix: utf-8*en / utf-8'en'
  label = label.split("*")[0].split("'")[0].trim();
  if (!label) return null;
  if (label === "us-ascii" || label === "ascii" || label === "ansi_x3.4-1968" || label === "iso646-us") return null;
  if (label === "utf8" || label === "utf_8" || label === "unicode-1-1-utf-8") return "utf-8";
  return label;
}

function decodeBytes(bytes: Uint8Array, charset: string | null | undefined): string {
  const label = normalizeCharset(charset);
  if (label && label !== "utf-8") {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unknown to TextDecoder: fall through to utf-8 / latin1.
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    if (label === "utf-8") return new TextDecoder("utf-8").decode(bytes);
  }
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    return Buffer.from(bytes).toString("latin1");
  }
}

function decodeBase64Url(data: string): Uint8Array {
  try {
    return Buffer.from(data.replace(/\s+/g, ""), "base64url");
  } catch {
    return new Uint8Array(0);
  }
}

const ENCODED_WORD_RE = /=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g;

function decodeEncodedText(encoding: string, text: string): Uint8Array | null {
  if (encoding === "B" || encoding === "b") {
    // Some mailers pad mid-word; decode each padded chunk separately.
    const chunks = text
      .replace(/\s+/g, "")
      .split(/(?<==)(?=[^=])/)
      .filter(Boolean);
    if (!chunks.every((chunk) => /^[A-Za-z0-9+/_-]*=*$/.test(chunk))) return null;
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64")));
  }
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "_") {
      bytes.push(0x20);
    } else if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = ch.charCodeAt(0);
      if (code < 0x80) bytes.push(code);
      else for (const b of Buffer.from(ch, "utf8")) bytes.push(b);
    }
  }
  return Uint8Array.from(bytes);
}

/** Decode RFC 2047 encoded-words (=?utf-8?B?...?= / Q-encoding, any charset TextDecoder knows). */
export function decodeMimeWords(value: string): string {
  if (typeof value !== "string") return "";
  if (!value.includes("=?")) return value;

  let out = "";
  let last = 0;
  let pendingCharset: string | null = null;
  let pendingChunks: Uint8Array[] = [];

  const flush = () => {
    if (pendingChunks.length > 0) out += decodeBytes(Buffer.concat(pendingChunks), pendingCharset);
    pendingChunks = [];
    pendingCharset = null;
  };

  for (const match of value.matchAll(ENCODED_WORD_RE)) {
    const index = match.index ?? 0;
    const between = value.slice(last, index);
    last = index + match[0].length;
    const charset = match[1];
    const bytes = decodeEncodedText(match[2], match[3]);
    if (bytes === null) {
      // Malformed: keep the literal text.
      flush();
      out += between + match[0];
      continue;
    }
    const adjacent = pendingChunks.length > 0 && /^\s*$/.test(between);
    if (adjacent && normalizeCharset(pendingCharset) === normalizeCharset(charset)) {
      // Same charset: join bytes, so a character split across words survives.
      pendingChunks.push(bytes);
      continue;
    }
    flush();
    // Whitespace between two encoded words is not part of the text.
    if (!adjacent) out += between;
    pendingCharset = charset;
    pendingChunks = [bytes];
  }
  flush();
  out += value.slice(last);
  return out;
}

/* ------------------------------------------------------------------------ */
/* Addresses                                                                */
/* ------------------------------------------------------------------------ */

function cleanAddress(raw: string): string | null {
  let address = raw.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  const mailto = /^mailto:/i.test(address);
  if (mailto) {
    address = address.slice(7);
    const query = address.indexOf("?");
    if (query !== -1) address = address.slice(0, query);
    try {
      address = decodeURIComponent(address);
    } catch {
      // keep as-is
    }
  }
  // Obsolete source route: <@relay1,@relay2:jane@x.com>
  if (address.startsWith("@") && address.includes(":")) address = address.slice(address.lastIndexOf(":") + 1);
  if (
    address.length >= 2 &&
    ((address.startsWith("'") && address.endsWith("'")) || (address.startsWith('"') && address.endsWith('"')))
  ) {
    address = address.slice(1, -1).trim();
  }
  address = address.replace(/\.+$/, "").toLowerCase();
  if (address.length === 0 || address.length > MAX_EMAIL_CHARS || !EMAIL_RE.test(address)) return null;
  return address;
}

function stripSurroundingQuotes(value: string): string {
  let name = value;
  for (;;) {
    if (name.length < 2) return name;
    const first = name[0];
    const last = name[name.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === "`" && last === "`")) {
      name = name.slice(1, -1).trim();
    } else {
      return name;
    }
  }
}

function cleanName(raw: string, email: string, lenient: boolean): string | null {
  let name = decodeMimeWords(raw);
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (lenient) name = name.replace(/["<>()]/g, " ").replace(/\s+/g, " ").trim();
  name = stripSurroundingQuotes(name);
  if (!name) return null;
  if (name.toLowerCase() === email || stripSurroundingQuotes(name.replace(/^<|>$/g, "")).toLowerCase() === email) {
    return null;
  }
  return sanitizeText(name, MAX_HEADER_CHARS);
}

/** Top-level split on "," / ";", dropping group display names ("Team:" … ";"). Null when unbalanced. */
function splitMailboxes(input: string, lenient: boolean): string[] | null {
  const segments: string[] = [];
  let current = "";
  let inQuote = false;
  let commentDepth = 0;
  let inAngle = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (!lenient) {
      if (inQuote) {
        current += ch;
        if (ch === "\\" && i + 1 < input.length) current += input[++i];
        else if (ch === '"') inQuote = false;
        continue;
      }
      if (commentDepth > 0) {
        current += ch;
        if (ch === "\\" && i + 1 < input.length) current += input[++i];
        else if (ch === "(") commentDepth++;
        else if (ch === ")") commentDepth--;
        continue;
      }
      if (inAngle) {
        current += ch;
        if (ch === ">") inAngle = false;
        continue;
      }
      if (ch === '"') {
        inQuote = true;
        current += ch;
        continue;
      }
      if (ch === "(") {
        commentDepth = 1;
        current += ch;
        continue;
      }
      if (ch === "<") {
        inAngle = true;
        current += ch;
        continue;
      }
    }
    if (ch === "," || ch === ";") {
      segments.push(current);
      current = "";
      continue;
    }
    if (ch === ":" && !/(?:^|[\s<"'])mailto$/i.test(current)) {
      // Group syntax: the text before ":" is the group's name, not a mailbox.
      if (current.includes("@")) segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  if (!lenient && (inQuote || commentDepth > 0 || inAngle)) return null;
  return segments;
}

/** Last whitespace-separated token that is a valid address, and the remaining text. */
function takeAddressToken(tokens: string[]): { email: string; rest: string } | null {
  for (let k = tokens.length - 1; k >= 0; k--) {
    const email = cleanAddress(tokens[k]);
    if (email) return { email, rest: [...tokens.slice(0, k), ...tokens.slice(k + 1)].join(" ") };
  }
  return null;
}

function parseMailbox(raw: string): Address | null {
  let phrase = "";
  const comments: string[] = [];
  let angle: string | null = null;

  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') {
      let j = i + 1;
      let quoted = "";
      while (j < raw.length && raw[j] !== '"') {
        if (raw[j] === "\\" && j + 1 < raw.length) j++;
        quoted += raw[j];
        j++;
      }
      phrase += quoted;
      i = j + 1;
      continue;
    }
    if (ch === "(") {
      let depth = 1;
      let j = i + 1;
      let comment = "";
      while (j < raw.length) {
        const c = raw[j];
        if (c === "\\" && j + 1 < raw.length) {
          comment += raw[j + 1];
          j += 2;
          continue;
        }
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) break;
        }
        comment += c;
        j++;
      }
      comments.push(comment);
      i = j + 1;
      continue;
    }
    if (ch === "<") {
      const end = raw.indexOf(">", i + 1);
      const content = end === -1 ? raw.slice(i + 1) : raw.slice(i + 1, end);
      if (angle === null || (cleanAddress(angle) === null && cleanAddress(content) !== null)) angle = content;
      i = end === -1 ? raw.length : end + 1;
      continue;
    }
    phrase += ch;
    i++;
  }

  let email: string | null = null;
  let name = "";
  if (angle !== null) {
    email = cleanAddress(angle);
    name = phrase;
  }
  if (email === null) {
    const token = takeAddressToken(phrase.split(/\s+/).filter(Boolean));
    if (!token) return null;
    email = token.email;
    name = token.rest;
  }
  const display = cleanName(name, email, false) ?? cleanName(comments.join(" "), email, false);
  return { email, name: display };
}

function parseMailboxLenient(raw: string): Address | null {
  const token = takeAddressToken(raw.split(/[\s<>()"]+/).filter(Boolean));
  if (!token) return null;
  return { email: token.email, name: cleanName(token.rest, token.email, true) };
}

function parseAddresses(input: string): Address[] {
  const strict = splitMailboxes(input, false);
  if (strict) {
    return strict.map((segment) => (segment.trim() ? parseMailbox(segment) : null)).filter((a): a is Address => a !== null);
  }
  const lenient = splitMailboxes(input, true) ?? [];
  return lenient
    .map((segment) => (segment.trim() ? parseMailboxLenient(segment) : null))
    .filter((a): a is Address => a !== null);
}

/**
 * RFC 5322 address-list parser tolerant of real-world headers:
 * quoted display names with commas, comments, groups ("undisclosed-recipients:;"),
 * bare addresses, encoded words. Emails lower-cased; invalid entries dropped;
 * duplicates removed (first wins).
 */
export function parseAddressList(value: string | null | undefined): Address[] {
  if (typeof value !== "string") return [];
  const input = value.replace(/[\r\n\t]+/g, " ");
  if (!input.trim()) return [];
  let addresses: Address[];
  try {
    addresses = parseAddresses(input);
    // Some mailers encode the whole header, addresses included.
    if (addresses.length === 0 && input.includes("=?")) {
      const decoded = decodeMimeWords(input);
      if (decoded !== input) addresses = parseAddresses(decoded.replace(/[\r\n\t]+/g, " "));
    }
  } catch {
    addresses = [];
  }
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const address of addresses) {
    if (seen.has(address.email)) continue;
    seen.add(address.email);
    out.push(address);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* MIME bodies                                                              */
/* ------------------------------------------------------------------------ */

function partMimeType(part: GmailMessagePart): string {
  const declared = typeof part.mimeType === "string" ? part.mimeType.trim().toLowerCase() : "";
  if (declared) return declared;
  const header = getHeader(part.headers, "Content-Type");
  const fromHeader = header?.split(";")[0].trim().toLowerCase() ?? "";
  return fromHeader || "text/plain";
}

function isAttachmentPart(part: GmailMessagePart): boolean {
  if (typeof part.filename === "string" && part.filename.trim() !== "") return true;
  const disposition = getHeader(part.headers, "Content-Disposition");
  return disposition !== null && /^\s*attachment\b/i.test(disposition);
}

/** RFC 3676 format=flowed: re-join soft-wrapped lines. */
function unflow(text: string, delsp: boolean): string {
  const out: string[] = [];
  let current: { depth: number; text: string } | null = null;
  const render = (entry: { depth: number; text: string }) =>
    entry.depth > 0 ? `${">".repeat(entry.depth)} ${entry.text}` : entry.text;

  for (const raw of text.split(/\r?\n/)) {
    let depth = 0;
    while (depth < raw.length && raw[depth] === ">") depth++;
    let content = raw.slice(depth);
    if (content.startsWith(" ")) content = content.slice(1);
    if (current && current.depth !== depth) {
      out.push(render(current));
      current = null;
    }
    if (current) current.text += content;
    else current = { depth, text: content };
    const soft = content !== "-- " && content.endsWith(" ");
    if (soft) {
      if (delsp) current.text = current.text.slice(0, -1);
    } else {
      out.push(render(current));
      current = null;
    }
  }
  if (current) out.push(render(current));
  return out.join("\n");
}

function decodePartText(part: GmailMessagePart, mimeType: string): string {
  const data = part.body?.data;
  if (typeof data !== "string" || data === "") return "";
  const contentType = getHeader(part.headers, "Content-Type");
  let text = decodeBytes(decodeBase64Url(data), headerParam(contentType, "charset"));
  if (mimeType === "text/plain" && headerParam(contentType, "format")?.toLowerCase() === "flowed") {
    text = unflow(text, headerParam(contentType, "delsp")?.toLowerCase() === "yes");
  }
  return text;
}

interface Bodies {
  text: string | null;
  html: string | null;
}

function walkBodies(part: GmailMessagePart | undefined, acc: Bodies, forwards: Bodies[], depth: number): void {
  if (!part || typeof part !== "object" || depth > MAX_MIME_DEPTH) return;
  const mimeType = partMimeType(part);
  const children = Array.isArray(part.parts) ? part.parts : [];

  if (mimeType === "message/rfc822" || mimeType === "message/global") {
    // An embedded (forwarded) message: its text is content, shown after the main text.
    const inner: Bodies = { text: null, html: null };
    const nested: Bodies[] = [];
    for (const child of children) walkBodies(child, inner, nested, depth + 1);
    if (inner.text !== null || inner.html !== null) forwards.push(inner);
    forwards.push(...nested);
    return;
  }
  if (isAttachmentPart(part)) return;
  if (mimeType.startsWith("multipart/") || (children.length > 0 && !part.body?.data)) {
    for (const child of children) walkBodies(child, acc, forwards, depth + 1);
    return;
  }
  if (mimeType !== "text/plain" && mimeType !== "text/html") return;
  // Large bodies Gmail stores as attachments (attachmentId, no data) need another request: ignored.
  const text = decodePartText(part, mimeType);
  if (!text.trim()) return;
  if (mimeType === "text/html") {
    if (acc.html === null) acc.html = text;
  } else if (acc.text === null) {
    acc.text = text;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Walk the MIME tree: first text/plain and first text/html (non-attachment) bodies, decoded. */
export function extractBodies(payload: GmailMessagePart | undefined): { text: string | null; html: string | null } {
  const main: Bodies = { text: null, html: null };
  const forwards: Bodies[] = [];
  try {
    walkBodies(payload, main, forwards, 0);
  } catch {
    return main;
  }
  if (forwards.length === 0) return main;

  const forwardTexts = forwards
    .map((f) => f.text ?? (f.html !== null ? htmlToText(f.html) : ""))
    .filter((t) => t.trim() !== "");
  const forwardHtmls = forwards.map((f) => f.html ?? (f.text !== null ? `<pre>${escapeHtml(f.text)}</pre>` : ""));
  const htmlParts = forwardHtmls.filter((h) => h.trim() !== "");

  if (main.text === null && main.html === null) {
    return {
      text: forwardTexts.length ? forwardTexts.join("\n\n") : null,
      html: htmlParts.length ? htmlParts.join("\n<br><br>\n") : null,
    };
  }
  return {
    text: main.text !== null ? [main.text, ...forwardTexts].join("\n\n") : null,
    html: main.html !== null ? [main.html, ...htmlParts].join("\n<br><br>\n") : null,
  };
}

/** Attachments = parts with a filename. */
export function extractAttachments(payload: GmailMessagePart | undefined): { filename: string; mimeType: string; size: number }[] {
  const out: { filename: string; mimeType: string; size: number }[] = [];
  const visit = (part: GmailMessagePart | undefined, depth: number) => {
    if (!part || typeof part !== "object" || depth > MAX_MIME_DEPTH) return;
    const filename = typeof part.filename === "string" ? part.filename.trim() : "";
    if (filename) {
      const size = Number(part.body?.size);
      out.push({
        filename: sanitizeText(decodeMimeWords(filename), MAX_HEADER_CHARS) ?? "attachment",
        mimeType: (typeof part.mimeType === "string" && part.mimeType.trim()) || "application/octet-stream",
        size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
      });
      return;
    }
    if (Array.isArray(part.parts)) for (const child of part.parts) visit(child, depth + 1);
  };
  try {
    visit(payload, 0);
  } catch {
    // keep what was collected
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* HTML → text                                                              */
/* ------------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  minus: "−",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  sbquo: "‚",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  curren: "¤",
  sect: "§",
  para: "¶",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  iexcl: "¡",
  iquest: "¿",
  ordf: "ª",
  ordm: "º",
  dagger: "†",
  Dagger: "‡",
  permil: "‰",
  prime: "′",
  Prime: "″",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  check: "✓",
  hearts: "♥",
  star: "☆",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  oelig: "œ",
  OElig: "Œ",
  oslash: "ø",
  Oslash: "Ø",
  eth: "ð",
  ETH: "Ð",
  thorn: "þ",
  THORN: "Þ",
  shy: "",
  zwnj: "‌",
  zwj: "‍",
  lrm: "",
  rlm: "",
};

// Accented Latin letters: &eacute; &Agrave; &ccedil; &ntilde; …
const DIACRITICS: Record<string, [string, string]> = {
  acute: ["́", "aeiouyAEIOUY"],
  grave: ["̀", "aeiouAEIOU"],
  circ: ["̂", "aeiouAEIOU"],
  uml: ["̈", "aeiouyAEIOUY"],
  tilde: ["̃", "anoANO"],
  ring: ["̊", "aA"],
  cedil: ["̧", "cC"],
  caron: ["̌", "sSzZcCrReEnN"],
};
for (const [suffix, [mark, letters]] of Object.entries(DIACRITICS)) {
  for (const letter of letters) NAMED_ENTITIES[`${letter}${suffix}`] = `${letter}${mark}`.normalize("NFC");
}

/** The C1 range of numeric references means windows-1252 (HTML spec). */
function cp1252Char(code: number): string {
  try {
    return new TextDecoder("windows-1252").decode(Uint8Array.of(code));
  } catch {
    return String.fromCharCode(code);
  }
}

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[0-9]{1,8}|#[xX][0-9a-fA-F]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) return match;
      if (code >= 0x80 && code <= 0x9f) return cp1252Char(code);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code === 0xe000 || code === 0xe001) {
        return "�";
      }
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : match;
  });
}

const SOFT_BREAK = "";
const PARAGRAPH_BREAK = "";

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

const FORWARD_HINT_RE =
  /(-{2,}\s*Forwarded message|Begin forwarded message|Message transféré|Début du message réexpédié|Mensaje reenviado|Weitergeleitete Nachricht|Messaggio inoltrato|Mensagem encaminhada|(?:Subject|Objet|Betreff|Asunto|Oggetto|Assunto)\s*:\s*(?:Fwd?|FW|TR|WG|RV)\s*:)/i;

function looksForwarded(htmlFragment: string): boolean {
  return FORWARD_HINT_RE.test(decodeEntities(stripTags(htmlFragment)).replace(/\s+/g, " "));
}

/** Index just past the element that starts at openEnd (nested same-name tags counted). */
function findElementEnd(html: string, openEnd: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = openEnd;
  let depth = 1;
  for (let match = re.exec(html); match; match = re.exec(html)) {
    if (match[1]) {
      depth--;
      if (depth === 0) return match.index + match[0].length;
    } else if (!match[0].endsWith("/>")) {
      depth++;
    }
  }
  return html.length;
}

/** Remove Gmail / Yahoo quote containers and Outlook's quoted thread (forwards are kept). */
function removeQuotedHtml(html: string): string {
  let s = html;
  const outlook = /<div\b[^>]*\bid\s*=\s*["']?(?:appendonsend|divRplyFwdMsg)\b[^>]*>/i.exec(s);
  if (outlook && !looksForwarded(s.slice(outlook.index, outlook.index + 4000))) s = s.slice(0, outlook.index);

  const quoteRe = /<(div|blockquote)\b[^>]*\bclass\s*=\s*["']?[^"'>]*\b(?:gmail_quote|yahoo_quoted)\b[^>]*>/gi;
  let from = 0;
  for (;;) {
    quoteRe.lastIndex = from;
    const match = quoteRe.exec(s);
    if (!match) break;
    const openEnd = match.index + match[0].length;
    const end = findElementEnd(s, openEnd, match[1]);
    if (looksForwarded(s.slice(match.index, Math.min(end, match.index + 3000)))) {
      from = openEnd;
      continue;
    }
    s = s.slice(0, match.index) + s.slice(end);
    from = match.index;
  }
  return s;
}

function sameUrl(text: string, url: string): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/, "")
      .replace(/\/+$/, "");
  return normalize(text) === normalize(url);
}

function convertHtml(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  s = s.replace(/<(head|script|style|title|noscript|template|xml)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(?:script|style)\b[^>]*\/>/gi, "");
  // Preformatted text keeps its line breaks.
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, inner: string) => {
    return `${SOFT_BREAK}${inner.replace(/\r?\n/g, "<br>")}${SOFT_BREAK}`;
  });
  // Source whitespace is not significant in HTML.
  s = s.replace(/\s+/g, " ");

  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_m, attrs: string, inner: string) => {
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const rawUrl = href ? (href[1] ?? href[2] ?? href[3] ?? "").trim() : "";
    const url = decodeEntities(rawUrl);
    const label = decodeEntities(stripTags(inner)).replace(/\s+/g, " ").trim();
    if (!label || !/^https?:\/\//i.test(url) || sameUrl(label, url)) return inner;
    return `${inner} (${rawUrl.replace(/</g, "&lt;").replace(/>/g, "&gt;")})`;
  });

  s = s.replace(/<br\b[^>]*>/gi, "\n");
  // Outlook writes every line as <p class=MsoNormal>: single line breaks.
  s = s.replace(/<p\b[^>]*\bMsoNormal\b[^>]*>([\s\S]*?)<\/p\s*>/gi, `${SOFT_BREAK}$1${SOFT_BREAK}`);
  s = s.replace(/<\/?(?:p|h[1-6])\b[^>]*>/gi, PARAGRAPH_BREAK);
  s = s.replace(/<li\b[^>]*>/gi, `${SOFT_BREAK}- `);
  s = s.replace(
    /<\/?(?:div|li|tr|table|tbody|thead|tfoot|caption|blockquote|ul|ol|dl|dt|dd|section|article|header|footer|nav|aside|main|address|center|figure|figcaption|form|fieldset|hr|pre|details|summary)\b[^>]*>/gi,
    SOFT_BREAK,
  );
  s = s.replace(/<\/?(?:td|th)\b[^>]*>/gi, " ");
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, "");
  s = s.replace(/<![^>]*>|<\?[^>]*>/g, "");
  s = decodeEntities(s);

  // Resolve break markers: soft = "end the current line", paragraph = "leave a blank line".
  s = s.replace(/[ \t]*([\n])[ \t]*/g, "$1");
  s = s.replace(/[\n]+/g, (run: string, offset: number) => {
    let trailing = offset === 0 ? 2 : 0;
    let out = "";
    for (const ch of run) {
      if (ch === "\n") {
        out += "\n";
        trailing++;
      } else if (ch === SOFT_BREAK) {
        if (trailing === 0) {
          out += "\n";
          trailing = 1;
        }
      } else {
        while (trailing < 2) {
          out += "\n";
          trailing++;
        }
      }
    }
    return out;
  });

  const invisibleEdges = /^[\s​‌⁠﻿­͏]+|[\s​‌⁠﻿­͏]+$/g;
  return s
    .replace(/[​⁠﻿­͏]/g, "")
    .split("\n")
    .map((line) => line.replace(invisibleEdges, "").replace(/[ \t ]{2,}/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML → readable plain text (drops script/style/head, keeps line structure and link text, decodes entities). */
export function htmlToText(html: string): string {
  if (typeof html !== "string" || html === "") return "";
  const input = html.replace(/[]/g, "");
  const withoutQuotes = removeQuotedHtml(input);
  const text = convertHtml(withoutQuotes);
  // A message that is nothing but a quote still shows the quote.
  if (text === "" && withoutQuotes !== input) return convertHtml(input);
  return text;
}

/* ------------------------------------------------------------------------ */
/* Quoted replies                                                           */
/* ------------------------------------------------------------------------ */

const WROTE_HEADER_RES = [
  /^On\b.{0,400}\bwrote\s*:$/i,
  /^Le\b.{0,400}\ba\s+écrit\s*:$/i,
  /^El\b.{0,400}\bescribió\s*:$/i,
  /^Am\b.{0,400}\bschrieb\b.{0,300}:$/i,
  /^Il\b.{0,400}\bha\s+scritto\s*:$/i,
  /^Em\b.{0,400}\bescreveu\s*:$/i,
  /^Op\b.{0,400}\bschreef\b.{0,300}:$/i,
];
const WROTE_START_RE = /^(?:On|Le|El|Am|Il|Em|Op)\b/i;
const WROTE_END_RE = /(?:\bwrote|a\s+écrit|escribió|schrieb|ha\s+scritto|escreveu|schreef|skrev|kirjoitti|napisał)\s*:$/i;
const ORIGINAL_MESSAGE_RE =
  /^-{2,}\s*(?:Original Message|Message d['’]origine|Ursprüngliche Nachricht|Mensaje original|Messaggio originale|Mensagem original|Oorspronkelijk bericht)\s*-{2,}$/i;
const FORWARD_MARKER_RE =
  /^(?:-{2,}\s*(?:Forwarded message|Message transféré|Mensaje reenviado|Weitergeleitete Nachricht|Messaggio inoltrato|Mensagem encaminhada|Doorgestuurd bericht)\s*-{2,}|(?:Begin forwarded message|Début du message réexpédié|Anfang der weitergeleiteten Nachricht|Inicio del mensaje reenviado)\s*:?)$/i;
const OUTLOOK_FROM_RE = /^\*?(?:From|De|Von|Da|Van|Från|Fra)\s*:\s*\*?\s*\S/i;
const OUTLOOK_SENT_RE = /^\*?(?:Sent|Envoyé|Gesendet|Enviado|Inviato|Verzonden|Skickat|Sendt|Date|Datum|Fecha|Data)\s*:/i;
const OUTLOOK_FORWARD_SUBJECT_RE =
  /^\*?(?:Subject|Objet|Betreff|Asunto|Oggetto|Assunto|Onderwerp)\s*:\s*\*?\s*(?:FW|Fwd?|TR|WG|RV|Doorst)\s*:/i;
const UNDERSCORE_RULE_RE = /^_{8,}$/;
const SIGNATURE_RE = /^--[  ]?$/;

/** Number of lines an attribution header ("On … wrote:") spans at line i, or 0. */
function matchWroteHeader(lines: string[], i: number): number {
  const first = lines[i].trim();
  if (!first || first.startsWith(">")) return 0;
  if (WROTE_START_RE.test(first)) {
    let joined = "";
    for (let k = 0; k < 3 && i + k < lines.length; k++) {
      const line = lines[i + k].trim();
      if (!line || (k > 0 && line.startsWith(">"))) break;
      joined = k === 0 ? line : `${joined} ${line}`;
      if (joined.length > 600) break;
      if (/[\d@]/.test(joined) && WROTE_HEADER_RES.some((re) => re.test(joined))) return k + 1;
    }
  }
  // "Jane Doe <jane@x.com> wrote:" directly followed by quoted lines.
  if (first.length <= 300 && WROTE_END_RE.test(first)) {
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j < lines.length && lines[j].trimStart().startsWith(">")) return 1;
  }
  return 0;
}

function matchOutlookBlock(lines: string[], i: number): "reply" | "forward" | null {
  if (i >= lines.length || !OUTLOOK_FROM_RE.test(lines[i].trim())) return null;
  let sent = false;
  let forward = false;
  for (let k = i + 1; k < Math.min(lines.length, i + 8); k++) {
    const line = lines[k].trim();
    if (!line) break;
    if (k <= i + 3 && OUTLOOK_SENT_RE.test(line)) sent = true;
    if (OUTLOOK_FORWARD_SUBJECT_RE.test(line)) forward = true;
  }
  if (!sent) return null;
  return forward ? "forward" : "reply";
}

function hasContent(lines: string[]): boolean {
  return lines.some((line) => line.trim() !== "");
}

function tidyLines(lines: string[]): string {
  return lines
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
}

function dropTrailingQuoteRun(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let cut = end;
  let k = end;
  while (k > 0) {
    const line = lines[k - 1].trim();
    if (line.startsWith(">")) {
      k--;
      cut = k;
    } else if (!line) {
      k--;
    } else {
      break;
    }
  }
  return lines.slice(0, cut);
}

function dropSignature(lines: string[]): string[] {
  for (let j = lines.length - 1; j > 0; j--) {
    if (SIGNATURE_RE.test(lines[j])) {
      const before = lines.slice(0, j);
      return hasContent(before) ? before : lines;
    }
  }
  return lines;
}

/**
 * Remove quoted history from a reply: "On <date>, <name> wrote:" (multi-line
 * variants and common non-English forms), lines starting with ">", Outlook
 * "From: … Sent: …" blocks, "-----Original Message-----", "Begin forwarded
 * message" is KEPT (forwards are content). Also trims trailing signatures
 * delimited by "-- ". Never returns an empty string for non-empty input that has
 * content before the quote.
 */
export function stripQuotedText(text: string): string {
  if (typeof text !== "string") return "";
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return "";
  const lines = normalized.split("\n");

  let cut = lines.length;
  let wroteHeaderLines = 0;
  let forwardAt = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (FORWARD_MARKER_RE.test(line)) {
      forwardAt = i;
      break;
    }
    const wrote = matchWroteHeader(lines, i);
    if (wrote > 0) {
      cut = i;
      wroteHeaderLines = wrote;
      break;
    }
    if (ORIGINAL_MESSAGE_RE.test(line)) {
      cut = i;
      break;
    }
    let block = matchOutlookBlock(lines, i);
    if (block === null && UNDERSCORE_RULE_RE.test(line)) {
      let j = i + 1;
      while (j < lines.length && j <= i + 2 && !lines[j].trim()) j++;
      block = matchOutlookBlock(lines, j);
    }
    if (block === "forward") {
      forwardAt = i;
      break;
    }
    if (block === "reply") {
      cut = i;
      break;
    }
  }

  if (forwardAt !== -1) {
    // Forwarded content is kept in full, including its own quotes and signatures.
    return tidyLines(lines);
  }

  let kept = dropTrailingQuoteRun(lines.slice(0, cut));
  if (!hasContent(kept)) {
    if (wroteHeaderLines > 0) {
      // Bottom-posted reply: the answer follows the quote.
      const after = lines.slice(cut + wroteHeaderLines).filter((line) => !line.trimStart().startsWith(">"));
      if (hasContent(after)) return tidyLines(dropSignature(after));
    }
    return tidyLines(lines);
  }
  kept = dropSignature(kept);
  // A quote that sat above the signature is trailing now.
  const withoutQuote = dropTrailingQuoteRun(kept);
  return tidyLines(hasContent(withoutQuote) ? withoutQuote : kept);
}

/* ------------------------------------------------------------------------ */
/* Automated mail                                                           */
/* ------------------------------------------------------------------------ */

const NOREPLY_LOCAL_RE =
  /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|bounces?|notifications?|notify|alerts?|newsletters?|news|updates?|automated|auto[-_.]?confirm|info[-_.]?noreply)\d*$/;
const NOREPLY_PART_RE = /(?:^|[-_.+])(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply)\d*(?:[-_.+]|$)/;

/** noreply@, no-reply@, donotreply@, mailer-daemon@, postmaster@, bounce*@, notifications@, … */
export function isNoReplyAddress(email: string): boolean {
  if (typeof email !== "string") return false;
  const address = email.trim().toLowerCase().replace(/^<|>$/g, "");
  if (address === "calendar-notification@google.com") return true;
  const at = address.lastIndexOf("@");
  if (at <= 0) return false;
  const local = address.slice(0, at);
  if (local.includes("+noreply") || local.startsWith("bounce")) return true;
  const base = local.split("+")[0];
  return NOREPLY_LOCAL_RE.test(base) || NOREPLY_PART_RE.test(local);
}

/** Why a message counts as automated (stored in messages.automated_reason). */
export type AutomatedReason = "list_id" | "precedence" | "auto_submitted" | "unsubscribe" | "category" | "noreply";

export interface AutomatedParams {
  headers: GmailHeader[] | undefined;
  labelIds: readonly string[];
  fromEmail: string | null;
  outbound: boolean;
  /** Reply-To addresses; enables the contact-form rule. */
  replyTo?: readonly (Address | string)[];
  /** My own addresses: a Reply-To pointing at me is not a contact-form sender. */
  selfEmails?: ReadonlySet<string>;
}

const PRECEDENCE_BULK_RE = /^(?:bulk|list|junk)\b/;

/**
 * A contact-form notification (Squarespace, Typeform, Wix…): sent from a
 * no-reply address with the real person in Reply-To, and no mailing-list
 * headers. Such mail is human correspondence.
 */
function hasRealReplyTo(params: AutomatedParams, fromEmail: string): boolean {
  for (const entry of params.replyTo ?? []) {
    const raw = typeof entry === "string" ? entry : entry?.email;
    if (typeof raw !== "string") continue;
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email === fromEmail || isNoReplyAddress(email)) continue;
    if (params.selfEmails?.has(email)) continue;
    return true;
  }
  return false;
}

/**
 * Why the message looks like a newsletter / notification / bulk mail, strongest
 * signal first: List-Id → "list_id"; Precedence bulk|list|junk → "precedence";
 * Auto-Submitted other than "no" → "auto_submitted"; List-Unsubscribe →
 * "unsubscribe"; CATEGORY_PROMOTIONS|SOCIAL label → "category" (not
 * UPDATES/FORUMS: Gmail files plenty of human mail there); a no-reply sender →
 * "noreply". Null when none applies, for outbound mail, and for contact forms
 * (no-reply sender + a real Reply-To address + no List-Id / List-Unsubscribe /
 * Precedence bulk header).
 */
export function automatedReason(params: AutomatedParams): AutomatedReason | null {
  if (params.outbound) return null;
  const { headers } = params;
  const listId = Boolean(getHeader(headers, "List-Id")?.trim());
  const unsubscribe = Boolean(getHeader(headers, "List-Unsubscribe")?.trim());
  const precedence = PRECEDENCE_BULK_RE.test(getHeader(headers, "Precedence")?.trim().toLowerCase() ?? "");
  const fromEmail = typeof params.fromEmail === "string" ? params.fromEmail.trim().toLowerCase() : "";
  const noReplySender = fromEmail !== "" && isNoReplyAddress(fromEmail);

  if (noReplySender && !listId && !unsubscribe && !precedence && hasRealReplyTo(params, fromEmail)) return null;
  if (listId) return "list_id";
  if (precedence) return "precedence";
  const autoSubmitted = getHeader(headers, "Auto-Submitted")?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted.split(/[\s;(]/)[0] !== "no") return "auto_submitted";
  if (unsubscribe) return "unsubscribe";
  const labels = new Set(params.labelIds ?? []);
  if (labels.has("CATEGORY_PROMOTIONS") || labels.has("CATEGORY_SOCIAL")) return "category";
  if (noReplySender) return "noreply";
  return null;
}

/**
 * Newsletter / notification / bulk detection: `automatedReason(params) !== null`.
 * Outbound messages are never automated. Only used to decide contact
 * auto-creation, body length, stats and default filtering.
 */
export function detectAutomated(params: AutomatedParams): boolean {
  return automatedReason(params) !== null;
}

/* ------------------------------------------------------------------------ */
/* Sanitizing                                                               */
/* ------------------------------------------------------------------------ */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Remove NUL and other characters Postgres text cannot store; truncate to `max`. */
export function sanitizeText(value: string | null | undefined, max?: number): string | null {
  if (value === null || value === undefined) return null;
  let text = String(value).replace(CONTROL_CHARS_RE, "").replace(LONE_SURROGATE_RE, "�").trim();
  if (!text) return null;
  if (max !== undefined && Number.isFinite(max) && text.length > max) {
    let end = Math.max(0, Math.floor(max));
    const code = text.charCodeAt(end - 1);
    if (end > 0 && code >= 0xd800 && code <= 0xdbff) end--;
    text = text.slice(0, end).trimEnd();
    if (!text) return null;
  }
  return text;
}

/* ------------------------------------------------------------------------ */
/* Full conversion                                                          */
/* ------------------------------------------------------------------------ */

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** "<id@host>" (first id of the header), brackets added when missing; ≤ 900 chars. */
function normalizeMessageId(value: string | null): string | null {
  if (!value) return null;
  const clean = sanitizeText(value.replace(/\s+/g, " "));
  if (!clean) return null;
  const bracketed = /<[^<>]+>/.exec(clean);
  const inner = (bracketed ? bracketed[0].slice(1, -1) : clean.replace(/^<+|>+$/g, "")).replace(/\s+/g, "");
  if (!inner) return null;
  let id = `<${inner}>`;
  if (id.length > MAX_MESSAGE_ID_CHARS) {
    const head = sanitizeText(id, MAX_MESSAGE_ID_CHARS - 1) ?? "<";
    id = `${head}>`;
  }
  return id;
}

/** Folding whitespace collapsed; when too long, keep the thread root and the most recent ids. */
function normalizeReferences(value: string | null): string | null {
  if (!value) return null;
  const clean = sanitizeText(value.replace(/\s+/g, " "));
  if (!clean) return null;
  if (clean.length <= MAX_HEADER_CHARS) return clean;
  const ids: string[] = Array.from(clean.matchAll(/<[^<>\s]+>/g), (m) => m[0]);
  const root = ids[0];
  if (root === undefined || root.length > MAX_HEADER_CHARS) return sanitizeText(clean, MAX_HEADER_CHARS);
  const tail: string[] = [];
  let length = root.length;
  for (let k = ids.length - 1; k >= 1; k--) {
    const id = ids[k];
    if (length + 1 + id.length > MAX_HEADER_CHARS) break;
    tail.unshift(id);
    length += 1 + id.length;
  }
  return [root, ...tail].join(" ");
}

function resolveSentAt(internalDate: string | undefined, dateHeader: string | null): Date {
  if (internalDate !== undefined && internalDate !== null && String(internalDate).trim() !== "") {
    const ms = Number(internalDate);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  }
  if (dateHeader) {
    const parsed = Date.parse(dateHeader.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim());
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return new Date();
}

function addressHeader(headers: GmailHeader[] | undefined, name: string): Address[] {
  const values = getHeaders(headers, name);
  return values.length ? parseAddressList(values.join(", ")) : [];
}

/**
 * Full conversion. Headers are looked up case-insensitively. Text parts are
 * decoded with their Content-Type charset (utf-8 fallback). `sentAt` from
 * internalDate (falls back to the Date header, then now). Direction is
 * outbound when labels include SENT or From is one of `selfEmails`.
 * All strings are sanitized (sanitizeText); header-derived strings truncated to
 * MAX_HEADER_CHARS; addresses validated like the DB check
 * (lower-case, contains "@", no spaces).
 */
export function parseGmailMessage(message: GmailMessage, options: { selfEmails: ReadonlySet<string> }): ParsedMessage {
  const payload = message?.payload && typeof message.payload === "object" ? message.payload : undefined;
  const headers = Array.isArray(payload?.headers) ? payload.headers : [];
  const labelIds = Array.isArray(message?.labelIds) ? message.labelIds.filter((l) => typeof l === "string") : [];

  const from =
    attempt(() => addressHeader(headers, "From")[0] ?? addressHeader(headers, "Sender")[0] ?? null, null) ?? null;
  const to = attempt(() => addressHeader(headers, "To"), []);
  const cc = attempt(() => addressHeader(headers, "Cc"), []);
  const bcc = attempt(() => addressHeader(headers, "Bcc"), []);
  const replyTo = attempt(() => addressHeader(headers, "Reply-To"), []);

  const outbound = labelIds.includes("SENT") || (from !== null && options.selfEmails.has(from.email));

  const subject = attempt(() => {
    const raw = getHeader(headers, "Subject");
    return raw === null ? null : sanitizeText(decodeMimeWords(raw.replace(/[\r\n\t]+/g, " ")), MAX_HEADER_CHARS);
  }, null);

  const rfc822MessageId = attempt(() => normalizeMessageId(getHeader(headers, "Message-ID")), null);
  const inReplyTo = attempt(() => normalizeMessageId(getHeader(headers, "In-Reply-To")), null);
  const references = attempt(() => normalizeReferences(getHeader(headers, "References")), null);

  const snippet = attempt(
    () =>
      typeof message.snippet === "string"
        ? sanitizeText(decodeEntities(message.snippet).replace(/\s+/g, " "), MAX_SNIPPET_CHARS)
        : null,
    null,
  );

  const reason = attempt(
    () =>
      automatedReason({
        headers,
        labelIds,
        fromEmail: from?.email ?? null,
        outbound,
        replyTo,
        selfEmails: options.selfEmails,
      }),
    null,
  );
  const isAutomated = reason !== null;

  const bodyText = attempt(() => {
    const { text, html } = extractBodies(payload);
    let body = "";
    if (text !== null && text.trim() !== "") body = text.slice(0, MAX_TEXT_INPUT_CHARS);
    else if (html !== null) body = htmlToText(html.slice(0, MAX_HTML_INPUT_CHARS));
    if (!body.trim()) return null;
    body = stripQuotedText(body);
    return sanitizeText(body, isAutomated ? MAX_AUTOMATED_BODY_CHARS : MAX_BODY_CHARS);
  }, null);

  const attachments = attempt(() => extractAttachments(payload), []);
  const sentAt = attempt(() => resolveSentAt(message.internalDate, getHeader(headers, "Date")), new Date());

  return {
    gmailMessageId: String(message?.id ?? ""),
    gmailThreadId: String(message?.threadId ?? message?.id ?? ""),
    labelIds,
    rfc822MessageId,
    inReplyTo,
    references,
    direction: outbound ? "outbound" : "inbound",
    from,
    to,
    cc,
    bcc,
    replyTo,
    subject,
    snippet,
    bodyText,
    sentAt,
    isAutomated,
    automatedReason: reason,
    hasAttachments: attachments.length > 0,
    attachments,
  };
}
