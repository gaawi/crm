/**
 * The organization tags a booking sheet filters on, grouped so anyone opening
 * the sheet (the owner, a colleague, Claude or ChatGPT) reads the same names.
 * The values live in organizations.tags; this file only names and groups them.
 * Tags not listed here still filter (group "From lists"), with their raw name.
 */

export type TagGroupKey = "type" | "place" | "ours" | "notfit" | "lists";

export interface TagInfo {
  tag: string;
  label: string;
  group: TagGroupKey;
  /** How it is set, for the (i): "auto" from research or rules, "manual" by a person. */
  how: "auto" | "manual";
  text: string;
}

export const TAG_GROUPS: { key: TagGroupKey; title: string; hint: string }[] = [
  { key: "type", title: "What they are", hint: "The kind of presenter, from its name and research." },
  { key: "place", title: "Where", hint: "Distance from New York and regional tours." },
  { key: "ours", title: "Our marks", hint: "Set by us: priorities, relationships, lists." },
  { key: "notfit", title: "Not a fit", hint: "Why a presenter is not for a chamber booking pitch." },
  { key: "lists", title: "From lists", hint: "Genres and labels imported with the lists (Musical America and others)." },
];

export const TAG_CATALOG: TagInfo[] = [
  { tag: "type-chamber-series", label: "Chamber series", group: "type", how: "auto", text: "Chamber music society, series or club (from the name)." },
  { tag: "chamber-specialist", label: "Chamber specialists", group: "type", how: "auto", text: "Presents mainly chamber music or recitals (from the research)." },
  { tag: "type-community-concerts", label: "Community concerts", group: "type", how: "auto", text: "Community or civic concert association." },
  { tag: "type-university", label: "University / college", group: "type", how: "auto", text: "A university, college or conservatory series." },
  { tag: "type-festival", label: "Festival", group: "type", how: "auto", text: "A festival (summer or seasonal)." },
  { tag: "type-arts-center", label: "Arts center / hall", group: "type", how: "auto", text: "Performing arts center, theater, hall or auditorium." },
  { tag: "type-museum-church", label: "Museum / church", group: "type", how: "auto", text: "A museum, gallery, church, synagogue or library with concerts." },
  { tag: "size-large-stage", label: "Large stage", group: "type", how: "auto", text: "Large productions: big halls that book big shows (useful for a large staged program)." },

  { tag: "nyc", label: "In NYC", group: "place", how: "auto", text: "In New York City (from the city). Co-productions or venue use, no fee pitch." },
  { tag: "nyc-under-5h", label: "< 5 h from NYC", group: "place", how: "auto", text: "About 5 hours or less by car from Midtown Manhattan." },
  { tag: "tour-northwest", label: "Tour: Northwest", group: "place", how: "manual", text: "2028-29 Pacific Northwest tour around Smith Fine Arts (Monmouth, OR)." },
  { tag: "tour-midwest", label: "Tour: Midwest", group: "place", how: "manual", text: "2028-29 Upper Midwest tour around Matinee Musicale (Duluth, MN)." },

  { tag: "prestigious", label: "Prestigious", group: "ours", how: "manual", text: "A place we really want to play." },
  { tag: "priority-a", label: "Priority A", group: "ours", how: "manual", text: "Round 2 review (Nov 2026): strong fit." },
  { tag: "priority-b", label: "Priority B", group: "ours", how: "manual", text: "Round 2 review (Nov 2026): good fit." },
  { tag: "priority-c", label: "Priority C", group: "ours", how: "manual", text: "Round 2 review (Nov 2026): small or long shot (no fee in the email)." },
  { tag: "existing-relationship", label: "Existing relationship", group: "ours", how: "manual", text: "We already know them: personal emails only, no mass first contact." },
  { tag: "josefina-2025", label: "Josefina 2025", group: "ours", how: "manual", text: "On Josefina's 2025 booking sheet." },

  { tag: "rental-only", label: "Rental only", group: "notfit", how: "manual", text: "The hall doesn't present its own concerts: artists rent it." },
  { tag: "closed", label: "Closed", group: "notfit", how: "manual", text: "No longer presents (or the organization closed)." },
  { tag: "notfit-pop-broadway", label: "Pop / Broadway", group: "notfit", how: "auto", text: "Broadway, pop, tribute or commercial shows." },
  { tag: "notfit-orchestra-opera-dance", label: "Orchestra / opera / dance", group: "notfit", how: "auto", text: "An orchestra, opera or dance company (produces its own)." },
  { tag: "notfit-jazz-folk", label: "Jazz / folk", group: "notfit", how: "auto", text: "Jazz, blues, folk or popular festival." },
  { tag: "notfit-specialist", label: "Specialist", group: "notfit", how: "auto", text: "Only guitar, solo piano, organ, early music or choral." },
  { tag: "notfit-education", label: "Education / training", group: "notfit", how: "auto", text: "School, academy, camp or training program." },
  { tag: "exclude-booking-usa-cold-outreach", label: "No mass first email", group: "notfit", how: "manual", text: "Never in a mass first-contact email (existing contact or relationship)." },
];

/** Bookkeeping tags never offered as filters. */
const HIDDEN = /^(research-|booking-usa-|booking-research-|musical-america|united-states$)/;

const BY_TAG = new Map(TAG_CATALOG.map((t) => [t.tag, t]));

export function tagInfo(tag: string): TagInfo {
  return (
    BY_TAG.get(tag) ?? {
      tag,
      label: tag.replace(/-/g, " "),
      group: "lists",
      how: "auto",
      text: "Imported with a list.",
    }
  );
}

export function isFilterableTag(tag: string): boolean {
  return !HIDDEN.test(tag);
}
