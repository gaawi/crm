/**
 * What a contact card still lacks. The campaign assistant fills the card
 * (role, organization and its profile, phone, photo…) before it writes an
 * email; the list tells it, and the owner, what is left. No "server-only":
 * shared with client components.
 */

export type CardField = "name" | "role" | "organization" | "organizationProfile" | "phone" | "photo";

export const CARD_FIELD_LABEL: Record<CardField, string> = {
  name: "name",
  role: "role",
  organization: "organization",
  organizationProfile: "organization profile",
  phone: "phone",
  photo: "photo",
};

export function cardMissing(c: {
  name: string | null;
  role: string | null;
  organizationId: string | null;
  organizationHasProfile: boolean;
  phone: string | null;
  photoUrl: string | null;
}): CardField[] {
  const missing: CardField[] = [];
  if (!c.name?.trim()) missing.push("name");
  if (!c.role?.trim()) missing.push("role");
  if (!c.organizationId) missing.push("organization");
  else if (!c.organizationHasProfile) missing.push("organizationProfile");
  if (!c.phone) missing.push("phone");
  if (!c.photoUrl) missing.push("photo");
  return missing;
}
