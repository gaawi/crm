import { z } from "zod";

/**
 * An organization's profile (organizations.profile): who a festival, venue
 * or presenter is, at a glance. Written by Claude through
 * POST /api/assistant-agent/profiles or by the owner on the organization
 * page. No "server-only": the types and the parsing helpers are shared with
 * client components.
 */

export const PROFILE_KINDS = ["series", "festival", "venue", "presenter", "organization", "other"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const PROFILE_KIND_LABEL: Record<ProfileKind, string> = {
  series: "Concert series",
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

/** An https URL, or undefined: anything else is dropped rather than failing the profile. */
const tolerantHttps = z
  .string()
  .trim()
  .max(2048)
  .nullish()
  .transform((v) => (v && isHttpsUrl(v) ? v : undefined))
  .optional();

export const venueSchema = z.object({
  name: text(200),
  type: optText(120),
  capacity: z.number().int().min(0).max(1_000_000).nullish(),
  notes: optText(500),
  /** Street address; its Maps link uses it instead of the venue's name. */
  address: optText(200),
  /** A photo of the hall from an official site (https). */
  photo: tolerantHttps,
  /** The page the photo comes from. */
  photoSource: tolerantHttps,
});

export const artistSchema = z.object({
  name: text(200),
  /** "String quartet", "Piano trio", "Pianist"… */
  formation: optText(120),
  /** "2025-26 season", "Nov 20, 2026"… */
  date: optText(60),
});

export const FIT_LEVELS = ["high", "medium", "low"] as const;
export type FitLevel = (typeof FIT_LEVELS)[number];

export const RELATIONSHIP_STATUSES = ["none", "contacted", "replied", "interested", "in_conversation", "declined", "booked"] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const PERSON_RELATIONS = ["decision", "programming", "talked", "primary", "admin", "other"] as const;
export type PersonRelation = (typeof PERSON_RELATIONS)[number];

const SIGNAL_VALUES = ["yes", "no", "unknown"] as const;

/** An enum value, or undefined: anything else is dropped rather than failing the profile. */
const tolerantEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .nullish()
    .transform((v) => ((values as readonly string[]).includes(v ?? "") ? (v as T[number]) : undefined))
    .optional();

/** A date Date.parse understands, stored as YYYY-MM-DD; anything else is dropped. */
const tolerantDate = z
  .string()
  .trim()
  .max(40)
  .nullish()
  .transform((v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString().slice(0, 10) : undefined))
  .optional();

/**
 * Booking analysis for the brand the campaign sells (CreArtBox in the USA,
 * ADAR in Europe): how well they fit, whom to pitch, where the relationship
 * stands and what to do next. Facts come from the sources; `fitReasons`,
 * `program` and `nextStep` are judgments and read as such. Nothing about fees,
 * budgets or availability unless the organization published it.
 */
export const bookingSchema = z.object({
  /** "CreArtBox" or "ADAR". */
  brand: optText(40),
  fit: tolerantEnum(FIT_LEVELS),
  fitReasons: optText(1500),
  /** What their programming shows: chamber music, international ensembles, contemporary music, multidisciplinary work, visuals. */
  signals: z
    .object({
      chamberMusic: tolerantEnum(SIGNAL_VALUES),
      international: tolerantEnum(SIGNAL_VALUES),
      contemporary: tolerantEnum(SIGNAL_VALUES),
      multidisciplinary: tolerantEnum(SIGNAL_VALUES),
      visual: tolerantEnum(SIGNAL_VALUES),
    })
    .nullish()
    .transform((v) => v ?? undefined)
    .optional(),
  /** Groups they presented that are close to us. */
  similarArtists: optList(text(160), 12),
  /** The program of ours that could fit, and why. */
  program: optText(800),
  /** Who should receive the proposal. */
  pitchTo: z
    .object({ name: text(200), role: optText(200), email: optText(320), why: optText(400) })
    .nullish()
    .transform((v) => v ?? undefined)
    .optional(),
  /** The season they are planning now, deadlines, calls for artists. */
  season: optText(800),
  /** What a personal email could mention. */
  emailHooks: optList(text(300), 8),
  relationship: z
    .object({
      status: tolerantEnum(RELATIONSHIP_STATUSES),
      /** Our last email to them. */
      lastSent: tolerantDate,
      /** Their last email to us. */
      lastReceived: tolerantDate,
      /** Who we wrote with, what we proposed, what they answered (quoted when it matters). */
      summary: optText(2000),
      /** "them": we wait for their answer; "us": they wait for ours. */
      waitingOn: tolerantEnum(["them", "us", "none"] as const),
      /** Dates or promises they made ("write again in February"). */
      commitments: optList(text(300), 8),
    })
    .nullish()
    .transform((v) => v ?? undefined)
    .optional(),
  nextStep: optText(500),
  /** What could not be confirmed and still needs checking. */
  pending: optList(text(300), 12),
  /** When the facts were last checked against the sources. */
  verifiedAt: tolerantDate,
});
export type BookingAnalysis = z.output<typeof bookingSchema>;

export const MAX_TAGLINE = 120;

export const orgProfileSchema = z.object({
  /** One line for lists: "Chamber music festival · Kuopio, Finland". */
  tagline: optText(MAX_TAGLINE),
  summary: text(1500),
  kind: z
    .enum(PROFILE_KINDS)
    .nullish()
    .transform((v) => v ?? undefined)
    .optional(),
  programming: optText(2000),
  /** The kinds of groups they present: "String quartets", "Piano trios", "Solo recitals", "Early music"… */
  formats: z
    .array(z.string().trim().max(80))
    .max(12)
    .nullish()
    .transform((v) => {
      const kept = (v ?? []).filter(Boolean);
      return kept.length ? kept : undefined;
    })
    .optional(),
  /** Who has played there (recent and upcoming), with the group's formation: what the owner checks before writing. */
  artists: optList(artistSchema, 40),
  /** Halls: name, type, capacity; the piano (make and model) goes in notes. */
  venues: optList(venueSchema, 20),
  /** "Kuopio": shown with the country as "Kuopio, Finland", linked to Google Maps. */
  city: optText(80),
  country: optText(60),
  /** Street address, shown as a Google Maps link. */
  address: optText(200),
  /** Free-text place (region, area); shown when city and country are missing. */
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
      phone: optText(60),
      /** decision: books the artists; programming: plans the season; talked: we have corresponded; primary; admin; other. */
      relation: tolerantEnum(PERSON_RELATIONS),
      /** Their photo from an official or professional page (https). */
      photo: tolerantHttps,
      /** Their page on the organization's site. */
      profileUrl: tolerantHttps,
      linkedin: tolerantHttps,
    }),
    20,
  ),
  booking: bookingSchema
    .nullish()
    .transform((v) => v ?? undefined)
    .optional(),
  /** The organization's logo from its official site (https). Anything else is dropped rather than failing the profile. */
  logo: tolerantHttps,
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
  /** "claude", "owner", or another researcher's name ("ChatGPT"). */
  researchedBy: optText(60),
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

/**
 * A stored value as a profile, or null when it is missing or has no valid
 * summary. Profiles written straight to the database skip validation, so an
 * invalid list item is dropped, an over-long list cut and any other invalid
 * field left out, rather than hiding the whole profile.
 */
export function readProfile(value: unknown): OrgProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let current: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (let attempt = 0; attempt < 10; attempt++) {
    const parsed = orgProfileSchema.safeParse(current);
    if (parsed.success) return parsed.data;
    const next: Record<string, unknown> = { ...current };
    const dropItems = new Map<string, Set<number>>();
    const caps = new Map<string, number>();
    for (const issue of parsed.error.issues) {
      const [key, index] = issue.path;
      if (typeof key !== "string" || key === "summary") return null;
      const field = next[key];
      if (Array.isArray(field) && typeof index === "number") {
        dropItems.set(key, (dropItems.get(key) ?? new Set()).add(index));
      } else if (Array.isArray(field) && issue.code === "too_big" && typeof issue.maximum === "number") {
        caps.set(key, issue.maximum);
      } else {
        delete next[key];
      }
    }
    // Invalid items go first, then the list is cut to its maximum.
    for (const [key, indexes] of dropItems) {
      const field = next[key];
      if (Array.isArray(field)) next[key] = field.filter((_, i) => !indexes.has(i));
    }
    for (const [key, max] of caps) {
      const field = next[key];
      if (Array.isArray(field)) next[key] = field.slice(0, max);
    }
    current = next;
  }
  return null;
}

/** The first sentence of a text, cut to `max` characters with an ellipsis. */
function firstSentence(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const sentence = /^.+?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  if (sentence.length <= max) return sentence.replace(/\.$/, "");
  const cut = sentence.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, "")}…`;
}

/** A Google Maps search for `query` (a place or "Name, City, Country"). */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * A Maps search for the first non-empty parts, joined with ", ". A part
 * already written in an earlier one (a city inside the address) is left out.
 */
export function mapsQueryUrl(parts: (string | null | undefined)[]): string | null {
  // " kuopionlahdenkatu 23 70100 kuopio ": whole words only, so "Kuopio" is in it but not in "Kuopionlahdenkatu".
  const words = (v: string) =>
    ` ${v
      .toLowerCase()
      .replace(/[\s,.;:()/]+/g, " ")
      .trim()} `;
  const kept: string[] = [];
  for (const raw of parts) {
    const part = raw?.replace(/\s+/g, " ").trim();
    if (part && !kept.some((k) => words(k).includes(words(part)))) kept.push(part);
  }
  return kept.length ? mapsSearchUrl(kept.join(", ")) : null;
}

/** The profile's place as Maps query parts: city + country, else location, else the organization's city. */
function placeParts(
  p: Pick<OrgProfile, "city" | "country" | "location"> | null | undefined,
  organization?: { city?: string | null } | null,
): (string | undefined)[] {
  if (p?.city || p?.country) return [p.city, p.country];
  return [p?.location ?? organization?.city ?? undefined];
}

/** Maps link of the profile's street address (address, city, country). */
export function addressMapsUrl(p: OrgProfile, organization?: { city?: string | null } | null): string | null {
  return p.address ? mapsQueryUrl([p.address, ...placeParts(p, organization)]) : null;
}

/** Maps link of a venue: its address, else its name, in the profile's city and country. */
export function venueMapsUrl(v: OrgProfileVenue, p: OrgProfile, organization?: { city?: string | null } | null): string | null {
  return mapsQueryUrl([v.address ?? v.name, ...placeParts(p, organization)]);
}

/** Where an organization is: what to show and its Google Maps link. */
export interface OrgPlace {
  /** "Kuopio, Finland". */
  label: string;
  /** The city (or the label's first part), to spot it in a tagline. */
  city: string;
  mapsUrl: string;
}

/**
 * "City, Country" from the profile, else the profile's location, else the
 * organization's city. The Maps link searches "Name, City, Country" (or
 * "Name, location") so the pin lands on the organization itself.
 */
export function orgPlace(
  organization: { name?: string | null; city?: string | null } | null | undefined,
  profile?: Pick<OrgProfile, "city" | "country" | "location"> | null,
): OrgPlace | null {
  const clean = (v: string | null | undefined) => v?.replace(/\s+/g, " ").trim() || undefined;
  const name = clean(organization?.name);
  const city = clean(profile?.city);
  const country = clean(profile?.country);
  const label = city || country ? [city, country].filter(Boolean).join(", ") : (clean(profile?.location) ?? clean(organization?.city));
  if (!label) return null;
  // A city that already names the country ("Kuopio, Finland") is not repeated.
  const shown = city && country && city.toLowerCase().endsWith(country.toLowerCase()) ? city : label;
  return {
    label: shown,
    city: city ?? shown.split(",")[0].trim(),
    mapsUrl: mapsSearchUrl([name, shown].filter(Boolean).join(", ")),
  };
}

/**
 * The profile in one line, as its two parts: what they are ("Chamber music
 * festival") and where (the place, linked to Maps). `lead` is the tagline
 * (a trailing " · Kuopio, Finland" dropped, the place is shown on its own),
 * else the kind when the place is known ("Festival"), else the summary's
 * first sentence.
 */
export function profileTaglineParts(
  p: OrgProfile,
  organization?: { name?: string | null; city?: string | null } | null,
): { lead: string; place: OrgPlace | null } {
  const place = orgPlace(organization, p);
  if (p.tagline) {
    const at = p.tagline.lastIndexOf(" · ");
    const tail = at > 0 ? p.tagline.slice(at + 3).toLowerCase() : "";
    const sameplace = place && tail && (tail.includes(place.city.toLowerCase()) || place.label.toLowerCase().includes(tail));
    return { lead: sameplace ? p.tagline.slice(0, at).trim() : p.tagline, place };
  }
  if (p.kind && p.kind !== "other" && place) return { lead: PROFILE_KIND_LABEL[p.kind], place };
  return { lead: firstSentence(p.summary, MAX_TAGLINE), place };
}

/** The tagline as plain text: "Chamber music festival · Kuopio, Finland". */
export function profileTagline(p: OrgProfile, organization?: { name?: string | null; city?: string | null } | null): string {
  const { lead, place } = profileTaglineParts(p, organization);
  return place ? `${lead} · ${place.label}` : lead;
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
      if (p.startsWith("@")) {
        venue.address = p.slice(1).trim() || undefined;
        continue;
      }
      if (/^https:\/\/\S+$/i.test(p) && isHttpsUrl(p) && !venue.photo) {
        venue.photo = p;
        continue;
      }
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
  return [v.name, v.type, v.capacity != null ? String(v.capacity) : null, v.notes, v.address ? `@ ${v.address}` : null, v.photo]
    .filter(Boolean)
    .join(" — ");
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
    tagline: p?.tagline ?? "",
    summary: p?.summary ?? "",
    city: p?.city ?? "",
    country: p?.country ?? "",
    address: p?.address ?? "",
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
