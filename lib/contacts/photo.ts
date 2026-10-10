/**
 * Contact photos (client and server): which URLs may be stored and shown.
 *
 * A photo is any https image URL (no credentials, no whitespace, at most
 * PHOTO_URL_MAX characters); the page it was found on (`photo_source`)
 * follows the same rule. The database checks the same shape
 * (supabase/migrations/20261012000000_contact_photos.sql). Photos are shown
 * with referrerPolicy="no-referrer" and fall back to initials when they fail.
 */

export const PHOTO_URL_MAX = 2048;

/** Why a value is not an acceptable https URL, or null when it is. */
export function httpsUrlIssue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "Give an https URL.";
  const raw = value.trim();
  if (raw.length > PHOTO_URL_MAX) return `URL longer than ${PHOTO_URL_MAX} characters.`;
  if (/\s/.test(raw)) return "URL contains spaces.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Not a valid URL.";
  }
  if (url.protocol !== "https:") return "Only https URLs are allowed.";
  if (!url.hostname) return "URL has no host.";
  if (url.username || url.password) return "URL must not contain a user name or password.";
  if (url.href.length > PHOTO_URL_MAX) return `URL longer than ${PHOTO_URL_MAX} characters.`;
  return null;
}

/** The normalized https URL, or null when the value is not acceptable. */
export function normalizeHttpsUrl(value: unknown): string | null {
  if (httpsUrlIssue(value)) return null;
  return new URL((value as string).trim()).href;
}

/** A photo URL safe to put in <img src>: the normalized https URL, else null (show initials). */
export function safePhotoUrl(value: string | null | undefined): string | null {
  return value ? normalizeHttpsUrl(value) : null;
}
