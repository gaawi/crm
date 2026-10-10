import { z } from "zod";

/**
 * An organization's profile (organizations.profile): who a festival, venue
 * or presenter is, at a glance. Written by Claude through
 * POST /api/assistant-agent/profiles or by the owner on the organization
 * page. No "server-only": the types and the parsing helpers are shared with
 * client components.
 */

export const PROFILE_KINDS = ["festival", "venue", "presenter", "organization", "other"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const PROFILE_KIND_LABEL: Record<ProfileKind, string> = {
  festival: "Festival",
  venue: "Venue",
  presenter: "Presenter",
  organization: "Organization",
  other: "Other",
};

export const MAX_PROFILE_IMAGES = 8;

/** True for an absolute https:// URL with a host (no credentials). */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Required trimmed text. */
const text = (max: number) => z.string().trim().min(1).max(max);
/** Optional text: "", null and missing all become undefined. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || undefined)
    .optional();
const httpsUrl = z.string().trim().max(2048).refine(isHttpsUrl, "Must be an https:// URL.");
/** Optional list: null / missing become undefined, an empty list too. */
const optList = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .nullish()
    .transform((v) => (v && v.length ? v : undefined))
    .optional();

export const venueSchema = z.object({
  name: text(200),
  type: optText(120),
  capacity: z.number().int().min(0).max(1_000_000).nullish(),
  notes: optText(500),
});

export const orgProfileSchema = z.object({
  summary: text(1500),
  kind: z
    .enum(PROFILE_KINDS)
    .nullish()
    .transform((v) => v ?? undefined)
    .optional(),
  programming: optText(2000),
  venues: optList(venueSchema, 20),
  location: optText(200),
  dates: optText(300),
  audience: optText(600),
  scale: optText(300),
  highlights: optList(text(300), 20),
  fitForAdar: optText(2000),
  ideas: optList(text(600), 12),
  contacts: optList(
    z.object({
      name: text(200),
      role: optText(200),
      email: z
        .email()
        .max(320)
        .nullish()
        .or(z.literal(""))
        .transform((v) => (v ? v.toLowerCase() : undefined))
        .optional(),
    }),
    20,
  ),
  images: optList(z.object({ url: httpsUrl, caption: optText(300), source: optText(2048) }), MAX_PROFILE_IMAGES),
  links: optList(z.object({ label: text(120), url: httpsUrl }), 20),
  sources: optList(httpsUrl, 30),
  /** Any date / timestamp Date.parse understands; stored as an ISO timestamp. */
  researchedAt: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Must be an ISO date.")
    .transform((v) => (v ? new Date(v).toISOString() : undefined))
    .optional(),
  researchedBy: z
    .enum(["claude", "owner"])
    .nullish()
    .transform((v) => v ?? undefined)
    .optional(),
});

/** A stored profile (what the card renders). */
export type OrgProfile = z.output<typeof orgProfileSchema>;
/** What a writer may send. */
export type OrgProfileInput = z.input<typeof orgProfileSchema>;
export type OrgProfileVenue = NonNullable<OrgProfile["venues"]>[number];

/** The organization a card belongs to. */
export interface OrgProfileOwner {
  id: string;
  name: string;
  website?: string | null;
  city?: string | null;
}

/** An organization with its profile, as lists (drafts, sheet rows) carry it. */
export interface OrgWithProfile extends OrgProfileOwner {
  profile: OrgProfile;
}

/** A stored value as a profile, or null when it is missing or no longer valid. */
export function readProfile(value: unknown): OrgProfile | null {
  if (!value || typeof value !== "object") return null;
  const parsed = orgProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** "summary: Too big" style message for the first issue of a failed parse. */
export function profileIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid profile.";
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

/* Owner's edit form --------------------------------------------------------- */

/** Splits "a — b — c" on em/en dashes, a spaced hyphen or a pipe. */
function parts(line: string): string[] {
  return line
    .split(/\s+[—–-]\s+|\s*[—–|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

/** "450", "450 seats", "1,200" → number; anything else → null. */
function capacityOf(value: string): number | null {
  const m = /^(?:capacity\s*:?\s*)?(\d{1,3}(?:[,.\s]\d{3})+|\d+)\s*(?:seats?|people|pax|cap(?:acity)?\.?|standing)?$/i.exec(value.trim());
  if (!m) return null;
  return Number(m[1].replace(/[,.\s]/g, ""));
}

/** "Main hall — black box theatre — 450 — notes" per line. Capacity can come second. */
export function parseVenueLines(value: string): OrgProfileVenue[] {
  return lines(value).map((line) => {
    const [name, ...rest] = parts(line);
    const venue: OrgProfileVenue = { name: name ?? line };
    const notes: string[] = [];
    for (const p of rest) {
      const capacity = capacityOf(p);
      if (capacity !== null && venue.capacity == null) venue.capacity = capacity;
      else if (!venue.type) venue.type = p;
      else notes.push(p);
    }
    if (notes.length) venue.notes = notes.join(" — ");
    return venue;
  });
}

export function venueLine(v: OrgProfileVenue): string {
  return [v.name, v.type, v.capacity != null ? String(v.capacity) : null, v.notes].filter(Boolean).join(" — ");
}

/** "https://… — caption" per line. Non-https lines are reported, not kept. */
export function parseImageLines(value: string): { images: { url: string; caption?: string }[]; invalid?: string } {
  const images: { url: string; caption?: string }[] = [];
  for (const line of lines(value)) {
    const [url, ...rest] = line.split(/\s+(?:[—–|]|-)\s+/);
    if (!isHttpsUrl(url)) return { images, invalid: url };
    images.push({ url, caption: rest.join(" — ").trim() || undefined });
  }
  return { images };
}

/** "Label — https://…" or a bare https URL (labelled with its host) per line. */
export function parseLinkLines(value: string): { links: { label: string; url: string }[]; invalid?: string } {
  const links: { label: string; url: string }[] = [];
  for (const line of lines(value)) {
    const urlMatch = /https?:\/\/\S+/i.exec(line);
    const url = urlMatch?.[0].replace(/[),.;]+$/, "") ?? "";
    if (!isHttpsUrl(url)) return { links, invalid: line };
    const label =
      line
        .replace(urlMatch![0], "")
        .replace(/^[\s—–|:-]+|[\s—–|:-]+$/g, "")
        .trim() || hostOf(url);
    links.push({ label: label.slice(0, 120), url });
  }
  return { links };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Form defaults for a stored profile. */
export function profileFormValues(p: OrgProfile | null) {
  return {
    kind: p?.kind ?? "",
    summary: p?.summary ?? "",
    location: p?.location ?? "",
    dates: p?.dates ?? "",
    scale: p?.scale ?? "",
    audience: p?.audience ?? "",
    programming: p?.programming ?? "",
    venues: (p?.venues ?? []).map(venueLine).join("\n"),
    highlights: (p?.highlights ?? []).join("\n"),
    fitForAdar: p?.fitForAdar ?? "",
    ideas: (p?.ideas ?? []).join("\n"),
    images: (p?.images ?? []).map((i) => [i.url, i.caption].filter(Boolean).join(" — ")).join("\n"),
    links: (p?.links ?? []).map((l) => `${l.label} — ${l.url}`).join("\n"),
  };
}
