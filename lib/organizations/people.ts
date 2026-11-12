import type { OrgProfile } from "./profile";

/**
 * Who matters at an organization: the person who decides (books the
 * artists or plans the season, from the profile's booking.pitchTo or a
 * profile contact marked decision / programming) and the people we are
 * talking with (they wrote to us, or the profile marks them as talked).
 * Shared by the organization page and the campaign sheet.
 */

export interface PersonFlags {
  /** Books the artists / plans the season. */
  decides: boolean;
  /** They have written to us (an actual conversation). */
  talking: boolean;
}

export interface Decider {
  name: string;
  role?: string;
  email?: string;
}

const TITLES = /\b(dr|mr|mrs|ms|prof|professor|jr|sr|ii|iii)\b\.?/g;

/** "Dr. John V. Sinclair" -> ["john", "sinclair"]: first and last word, lowercase, no accents or titles. */
function nameKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const words = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["“”'’()]/g, " ")
    .replace(TITLES, " ")
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (words.length < 2) return null;
  return `${words[0]} ${words[words.length - 1]}`;
}

/** True when two names are the same person (first and last name match). */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = nameKey(a);
  return ka !== null && ka === nameKey(b);
}

/** The person who decides, from the profile: booking.pitchTo, else a contact marked decision, else programming. */
export function deciderOf(profile: OrgProfile | null | undefined): Decider | null {
  if (!profile) return null;
  const pitch = profile.booking?.pitchTo;
  if (pitch?.name) return { name: pitch.name, role: pitch.role, email: pitch.email };
  for (const relation of ["decision", "programming"] as const) {
    const found = profile.contacts?.find((c) => c.relation === relation);
    if (found) return { name: found.name, role: found.role, email: found.email };
  }
  return null;
}

/** Flags for one contact of the organization. */
export function personFlags(
  contact: { name?: string | null; displayName?: string | null; emails?: string[]; email?: string | null; lastInboundAt?: Date | string | null },
  profile: OrgProfile | null | undefined,
): PersonFlags {
  const decider = deciderOf(profile);
  const names = [contact.name, contact.displayName];
  const emails = [...(contact.emails ?? []), contact.email].filter(Boolean).map((e) => e!.toLowerCase());
  const decides = Boolean(
    decider &&
      (names.some((n) => sameName(n, decider.name)) || (decider.email && emails.includes(decider.email.toLowerCase()))),
  );
  const talkedInProfile = Boolean(
    profile?.contacts?.some((c) => c.relation === "talked" && (names.some((n) => sameName(n, c.name)) || (c.email && emails.includes(c.email)))),
  );
  return { decides, talking: Boolean(contact.lastInboundAt) || talkedInProfile };
}

/** Left-border color class for a flagged row: decides wins over talking. */
export function flagBorderClass(flags: PersonFlags | null | undefined): string | null {
  if (!flags) return null;
  if (flags.decides) return "border-l-4 border-l-amber-500";
  if (flags.talking) return "border-l-4 border-l-emerald-500";
  return null;
}
