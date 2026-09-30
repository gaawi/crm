import type { Address } from "@/lib/types";
import type { GmailHeader, GmailMessage, GmailMessagePart, ParsedMessage } from "@/lib/gmail/types";

/** Pure functions: Gmail API message → ParsedMessage. No I/O. */

export const MAX_BODY_CHARS = 20_000;
/** Automated mail keeps a short body (a human reply sent through a marketing tool still shows). */
export const MAX_AUTOMATED_BODY_CHARS = 2_000;
/** Header-derived strings (subject, Message-ID, References, names) are truncated to this. */
export const MAX_HEADER_CHARS = 2_000;

/** Gmail system labels whose messages are not imported (when not already stored). */
export const EXCLUDED_LABELS = ["SPAM", "TRASH", "DRAFT", "CHAT", "SCHEDULED"] as const;

/** "promotions" → "CATEGORY_PROMOTIONS" */
export function categoryLabel(category: string): string {
  void category;
  throw new Error("TODO");
}

/**
 * True when a message with these labels must not be stored: any EXCLUDED_LABELS,
 * or a CATEGORY_* label for one of skipCategories.
 */
export function shouldSkipLabels(labelIds: readonly string[], skipCategories: readonly string[]): boolean {
  void labelIds;
  void skipCategories;
  throw new Error("TODO");
}

/**
 * Gmail search query for the historical import that mirrors shouldSkipLabels:
 * "-in:chats -in:drafts -category:promotions -category:social" + extra.
 * (Spam/trash are excluded by includeSpamTrash=false.)
 */
export function buildBackfillQuery(skipCategories: readonly string[], extra?: string): string {
  void skipCategories;
  void extra;
  throw new Error("TODO");
}

/** Case-insensitive header lookup (first match). */
export function getHeader(headers: GmailHeader[] | undefined, name: string): string | null {
  void headers;
  void name;
  throw new Error("TODO");
}

/** Decode RFC 2047 encoded-words (=?utf-8?B?...?= / Q-encoding, any charset TextDecoder knows). */
export function decodeMimeWords(value: string): string {
  void value;
  throw new Error("TODO");
}

/**
 * RFC 5322 address-list parser tolerant of real-world headers:
 * quoted display names with commas, comments, groups ("undisclosed-recipients:;"),
 * bare addresses, encoded words. Emails lower-cased; invalid entries dropped;
 * duplicates removed (first wins).
 */
export function parseAddressList(value: string | null | undefined): Address[] {
  void value;
  throw new Error("TODO");
}

/** Walk the MIME tree: first text/plain and first text/html (non-attachment) bodies, decoded. */
export function extractBodies(payload: GmailMessagePart | undefined): { text: string | null; html: string | null } {
  void payload;
  throw new Error("TODO");
}

/** Attachments = parts with a filename. */
export function extractAttachments(payload: GmailMessagePart | undefined): { filename: string; mimeType: string; size: number }[] {
  void payload;
  throw new Error("TODO");
}

/** HTML → readable plain text (drops script/style/head, keeps line structure and link text, decodes entities). */
export function htmlToText(html: string): string {
  void html;
  throw new Error("TODO");
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
  void text;
  throw new Error("TODO");
}

/** noreply@, no-reply@, donotreply@, mailer-daemon@, postmaster@, bounce*@, notifications@, … */
export function isNoReplyAddress(email: string): boolean {
  void email;
  throw new Error("TODO");
}

/**
 * Newsletter / notification / bulk detection: List-Unsubscribe or List-Id
 * header, Precedence bulk|list|junk, Auto-Submitted other than "no",
 * CATEGORY_PROMOTIONS|SOCIAL label, or a no-reply sender. (Not UPDATES/FORUMS:
 * Gmail files plenty of human mail there.) Outbound messages are never automated.
 * Only used to decide contact auto-creation, body length and default filtering.
 */
export function detectAutomated(params: {
  headers: GmailHeader[] | undefined;
  labelIds: readonly string[];
  fromEmail: string | null;
  outbound: boolean;
}): boolean {
  void params;
  throw new Error("TODO");
}

/** Remove NUL and other characters Postgres text cannot store; truncate to `max`. */
export function sanitizeText(value: string | null | undefined, max?: number): string | null {
  void value;
  void max;
  throw new Error("TODO");
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
  void message;
  void options;
  throw new Error("TODO");
}
