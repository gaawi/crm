import type { Address } from "@/lib/types";

/**
 * Build an RFC 2822 message for users.drafts.create.
 * - UTF-8 text/plain body, Content-Transfer-Encoding: base64 (76-char lines).
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
  subject: string;
  bodyText: string;
  inReplyTo?: string | null;
  references?: string | null;
  date?: Date;
}): string {
  void params;
  throw new Error("TODO");
}

/** "Re: Hello" stays; "Hello" → "Re: Hello"; handles "RE:", "Fwd:" prefixes sensibly. */
export function replySubject(subject: string | null): string {
  void subject;
  throw new Error("TODO");
}

/** RFC 2047 B-encode a header value if it contains non-ASCII characters. */
export function encodeHeaderValue(value: string): string {
  void value;
  throw new Error("TODO");
}

/** Format an address for a header: `"Doe, Jane" <jane@x.com>` / `jane@x.com`. */
export function formatAddress(address: Address): string {
  void address;
  throw new Error("TODO");
}
