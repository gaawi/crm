/**
 * Undo "mojibake": UTF-8 text that was decoded with a single-byte charset, so
 * "días" became "dÃ­as" (windows-1252) and "Ramovš" became "RamovĹĄ"
 * (iso-8859-2). Each run of non-ASCII characters is mapped back to the bytes
 * that charset gave them; the run is replaced only when those bytes are valid
 * UTF-8, which text really written in that charset practically never is
 * ("é" alone, or Polish "ąś", stay as they are).
 */

const CHARSETS = ["windows-1252", "iso-8859-2"] as const;

const reverseMaps = new Map<string, Map<string, number>>();

function reverseMap(charset: string): Map<string, number> {
  let map = reverseMaps.get(charset);
  if (!map) {
    map = new Map();
    const decoder = new TextDecoder(charset);
    for (let byte = 0x80; byte <= 0xff; byte++) {
      const char = decoder.decode(Uint8Array.of(byte));
      if (char !== "�" && !map.has(char)) map.set(char, byte);
    }
    reverseMaps.set(charset, map);
  }
  return map;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function repairRun(run: string): string {
  for (const charset of CHARSETS) {
    const map = reverseMap(charset);
    const bytes: number[] = [];
    for (const char of run) {
      const byte = map.get(char);
      if (byte === undefined) break;
      bytes.push(byte);
    }
    if (bytes.length !== [...run].length) continue;
    try {
      return utf8.decode(Uint8Array.from(bytes));
    } catch {
      // Not UTF-8 read as this charset: try the next one.
    }
  }
  return run;
}

/** True when the text likely holds mojibake (a cheap check before repairMojibake). */
export function looksLikeMojibake(text: string): boolean {
  return /[ÃÂÄÅĂĹâ][\u0080-˿‐-›€™]/.test(text);
}

/** The text with mojibake runs restored; unchanged when there is nothing to repair. */
export function repairMojibake(text: string): string {
  if (!looksLikeMojibake(text)) return text;
  return text.replace(/[^\x00-\x7f]{2,}/g, repairRun);
}
