import { GmailApiError } from "@/lib/gmail/client";
import { OAuthError } from "@/lib/gmail/oauth";
import { errorMessage, truncate } from "@/lib/utils";

/** gmail_accounts.last_error is kept short. */
export const MAX_ERROR_CHARS = 500;

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED"]);

/** Short human-readable description of a sync failure (for gmail_accounts.last_error). */
export function describeSyncError(error: unknown): string {
  let message: string;
  if (error instanceof GmailApiError) {
    message = error.status > 0 ? `Gmail API error ${error.status}: ${error.message}` : error.message;
  } else if (error instanceof OAuthError) {
    message = `Google sign-in error ${error.status} (${error.code}): ${error.message}`;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = errorMessage(error);
  }
  return truncate(message.replace(/\s+/g, " ").trim() || "Unknown error", MAX_ERROR_CHARS);
}

/** Gmail quota errors that survived the client's own retries. */
export function isRateLimitError(error: unknown): boolean {
  return (
    error instanceof GmailApiError &&
    (error.status === 429 || (error.status === 403 && error.reason !== null && RATE_LIMIT_REASONS.has(error.reason)))
  );
}

/** "2 messages could not be stored (abc: invalid byte sequence …)" or null. */
export function summarizeFailures(failures: readonly { gmailMessageId: string; error: string }[]): string | null {
  if (failures.length === 0) return null;
  const first = failures[0];
  const noun = failures.length === 1 ? "message" : "messages";
  return truncate(
    `${failures.length} ${noun} could not be stored (first: ${first.gmailMessageId}: ${first.error})`.replace(/\s+/g, " "),
    MAX_ERROR_CHARS,
  );
}
