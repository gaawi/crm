/**
 * Instruments (and voice types) for the musicians roster.
 *
 * Stored as canonical keys ("cello", "soprano"…) so "violonchelo", "chelo",
 * "cellist" and "cellista" all find the same people. Anything not in the list
 * is stored as typed, lower-case ("theorbo" → "theorbo").
 */

export interface Instrument {
  key: string;
  label: string;
  /** Families used for search: "strings", "voice"… ("voz" finds every voice type). */
  family: InstrumentFamily;
  /** Other names, English and Spanish, player nouns included. Accents don't matter. */
  aliases: string[];
}

export type InstrumentFamily = "strings" | "keyboards" | "winds" | "brass" | "percussion" | "voice" | "plucked" | "other";

export const FAMILY_ALIASES: Record<InstrumentFamily, string[]> = {
  strings: ["strings", "string", "cuerda", "cuerdas"],
  keyboards: ["keyboards", "keyboard", "teclado", "teclados", "tecla"],
  winds: ["winds", "woodwinds", "woodwind", "viento", "viento madera", "maderas"],
  brass: ["brass", "metales", "viento metal"],
  percussion: ["percussion", "percusion"],
  voice: ["voice", "voices", "singer", "singers", "vocal", "voz", "voces", "cantante", "cantantes", "canto"],
  plucked: ["plucked", "pulsada", "cuerda pulsada"],
  other: [],
};

export const INSTRUMENTS: Instrument[] = [
  { key: "violin", label: "Violin", family: "strings", aliases: ["violín", "violinist", "violinista", "fiddle"] },
  { key: "viola", label: "Viola", family: "strings", aliases: ["violist", "violista"] },
  { key: "cello", label: "Cello", family: "strings", aliases: ["violoncello", "violonchelo", "chelo", "cellist", "cellista", "violonchelista", "chelista"] },
  { key: "double-bass", label: "Double bass", family: "strings", aliases: ["double bass", "contrabass", "upright bass", "contrabajo", "contrabajista", "bassist"] },
  { key: "viola-da-gamba", label: "Viola da gamba", family: "strings", aliases: ["viola da gamba", "viola de gamba", "gamba", "gambist", "gambista", "viol"] },
  { key: "piano", label: "Piano", family: "keyboards", aliases: ["pianist", "pianista", "fortepiano"] },
  { key: "harpsichord", label: "Harpsichord", family: "keyboards", aliases: ["clave", "clavecín", "clavecin", "harpsichordist", "clavecinista"] },
  { key: "organ", label: "Organ", family: "keyboards", aliases: ["órgano", "organist", "organista"] },
  { key: "accordion", label: "Accordion", family: "keyboards", aliases: ["acordeón", "accordionist", "acordeonista"] },
  { key: "bandoneon", label: "Bandoneon", family: "keyboards", aliases: ["bandoneón", "bandoneonista"] },
  { key: "guitar", label: "Guitar", family: "plucked", aliases: ["guitarra", "guitarist", "guitarrista"] },
  { key: "harp", label: "Harp", family: "plucked", aliases: ["arpa", "harpist", "arpista"] },
  { key: "lute", label: "Lute / theorbo", family: "plucked", aliases: ["laúd", "laud", "lutenist", "theorbo", "tiorba", "archlute", "laudista", "tiorbista"] },
  { key: "mandolin", label: "Mandolin", family: "plucked", aliases: ["mandolina", "mandolinist", "mandolinista"] },
  { key: "flute", label: "Flute", family: "winds", aliases: ["flauta", "flautist", "flutist", "flautista", "piccolo", "flauta travesera"] },
  { key: "recorder", label: "Recorder", family: "winds", aliases: ["flauta de pico", "flauta dulce", "recorder player"] },
  { key: "oboe", label: "Oboe", family: "winds", aliases: ["oboist", "oboísta", "oboista", "cor anglais", "english horn", "corno inglés"] },
  { key: "clarinet", label: "Clarinet", family: "winds", aliases: ["clarinete", "clarinetist", "clarinettist", "clarinetista"] },
  { key: "bassoon", label: "Bassoon", family: "winds", aliases: ["fagot", "bassoonist", "fagotista"] },
  { key: "saxophone", label: "Saxophone", family: "winds", aliases: ["saxofón", "saxofon", "sax", "saxo", "saxophonist", "saxofonista"] },
  { key: "horn", label: "Horn", family: "brass", aliases: ["french horn", "trompa", "hornist", "trompista"] },
  { key: "trumpet", label: "Trumpet", family: "brass", aliases: ["trompeta", "trumpeter", "trompetista"] },
  { key: "trombone", label: "Trombone", family: "brass", aliases: ["trombón", "trombonist", "trombonista"] },
  { key: "tuba", label: "Tuba", family: "brass", aliases: ["tubist", "tubista"] },
  { key: "percussion", label: "Percussion", family: "percussion", aliases: ["percusión", "percussionist", "percusionista", "timpani", "timbales", "marimba", "vibraphone", "vibráfono"] },
  { key: "drums", label: "Drums", family: "percussion", aliases: ["batería", "bateria", "drummer", "baterista", "drum kit"] },
  { key: "voice", label: "Voice", family: "voice", aliases: ["voz", "vocalist", "vocalista", "singer", "cantante"] },
  { key: "soprano", label: "Soprano", family: "voice", aliases: [] },
  { key: "mezzo-soprano", label: "Mezzo-soprano", family: "voice", aliases: ["mezzo", "mezzosoprano"] },
  { key: "contralto", label: "Contralto / alto", family: "voice", aliases: ["alto"] },
  { key: "countertenor", label: "Countertenor", family: "voice", aliases: ["contratenor"] },
  { key: "tenor", label: "Tenor", family: "voice", aliases: [] },
  { key: "baritone", label: "Baritone", family: "voice", aliases: ["barítono", "baritono"] },
  { key: "bass-voice", label: "Bass (voice)", family: "voice", aliases: ["bass voice", "bass singer", "bajo", "bajo cantante"] },
  { key: "conductor", label: "Conductor", family: "other", aliases: ["director", "directora", "director de orquesta", "conducting"] },
  { key: "composer", label: "Composer", family: "other", aliases: ["compositor", "compositora"] },
  { key: "electronics", label: "Electronics", family: "other", aliases: ["electrónica", "electronica", "live electronics", "sound artist", "artista sonoro"] },
];

const BY_KEY = new Map(INSTRUMENTS.map((i) => [i.key, i]));

/** Lower case, no accents, single spaces: "Violonchelo " → "violonchelo". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const LOOKUP = new Map<string, string>();
for (const i of INSTRUMENTS) {
  for (const name of [i.key, i.label, ...i.aliases]) LOOKUP.set(fold(name), i.key);
}
// "bass" alone means the double bass (players say "bass"; singers say "bajo").
LOOKUP.set("bass", "double-bass");

/** One typed instrument → its key, or the folded text when unknown. Empty → null. */
export function normalizeInstrument(raw: string): string | null {
  const folded = fold(raw).replace(/[^\p{L}\p{N} '/-]/gu, "").trim().slice(0, 60);
  if (!folded) return null;
  return LOOKUP.get(folded) ?? LOOKUP.get(folded.replace(/s$/, "")) ?? folded;
}

/** "Cello, violonchelo; piano" → ["cello", "piano"] (deduplicated, max 12). */
export function parseInstruments(raw: string | string[]): string[] {
  const parts = Array.isArray(raw) ? raw : raw.split(/[,;\n·]+/);
  const out: string[] = [];
  for (const part of parts) {
    const key = normalizeInstrument(part);
    if (key && !out.includes(key)) out.push(key);
  }
  return out.slice(0, 12);
}

/** Display name of a stored instrument: "cello" → "Cello", "theorbo" → "Theorbo". */
export function instrumentLabel(key: string): string {
  const known = BY_KEY.get(key);
  if (known) return known.label;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function instrumentFamily(key: string): InstrumentFamily {
  return BY_KEY.get(key)?.family ?? "other";
}

/**
 * The instrument keys a search means: "cellista" → ["cello"], "voz" → every
 * voice type, "vio" → violin, viola, cello (via violonchelo)… Free-text
 * instruments in use (`known`) match by prefix too. Empty when nothing fits.
 */
export function instrumentsMatching(query: string, known: string[] = []): string[] {
  const q = fold(query);
  if (!q) return [];
  const keys = new Set<string>();
  for (const [family, names] of Object.entries(FAMILY_ALIASES) as [InstrumentFamily, string[]][]) {
    if (names.some((n) => fold(n) === q)) for (const i of INSTRUMENTS) if (i.family === family) keys.add(i.key);
  }
  const exact = LOOKUP.get(q) ?? LOOKUP.get(q.replace(/s$/, ""));
  if (exact) keys.add(exact);
  if (q.length >= 3) {
    for (const [name, key] of LOOKUP) if (name.startsWith(q)) keys.add(key);
    for (const k of known) if (fold(k).startsWith(q)) keys.add(k);
  }
  return [...keys];
}

export const ROSTER_STATUSES = [
  { value: "roster", label: "In our roster", short: "Roster", hint: "We'd call them" },
  { value: "maybe", label: "Maybe", short: "Maybe", hint: "Not sure yet" },
  { value: "not_now", label: "Not for now", short: "Not now", hint: "Not a fit at the moment" },
] as const;

export type RosterStatus = (typeof ROSTER_STATUSES)[number]["value"];

export function rosterLabel(value: RosterStatus): string {
  return ROSTER_STATUSES.find((s) => s.value === value)?.short ?? value;
}
