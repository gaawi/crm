import { describe, expect, it } from "vitest";
import { instrumentLabel, instrumentsMatching, normalizeInstrument, parseInstruments } from "@/lib/musicians/instruments";

describe("musician instruments", () => {
  it("stores Spanish and English names, player nouns included, as one key", () => {
    for (const name of ["Cello", "violonchelo", "Violonchelo ", "chelo", "cellist", "Cellista", "violoncello"]) {
      expect(normalizeInstrument(name)).toBe("cello");
    }
    expect(normalizeInstrument("Violín")).toBe("violin");
    expect(normalizeInstrument("contrabajo")).toBe("double-bass");
    expect(normalizeInstrument("bass")).toBe("double-bass");
    expect(normalizeInstrument("Mezzo")).toBe("mezzo-soprano");
    expect(normalizeInstrument("pianistas")).toBe("piano");
    expect(normalizeInstrument("Voz")).toBe("voice");
  });

  it("keeps unknown instruments as typed (lower case) and drops empty ones", () => {
    expect(normalizeInstrument("Nyckelharpa")).toBe("nyckelharpa");
    expect(normalizeInstrument("  ")).toBeNull();
    expect(instrumentLabel("nyckelharpa")).toBe("Nyckelharpa");
    expect(instrumentLabel("viola-da-gamba")).toBe("Viola da gamba");
  });

  it("parses a typed list, deduplicated", () => {
    expect(parseInstruments("Cello, violonchelo; viola de gamba\npiano")).toEqual(["cello", "viola-da-gamba", "piano"]);
    expect(parseInstruments(["soprano", "Soprano", ""])).toEqual(["soprano"]);
  });

  it("understands searches: player nouns, families and prefixes", () => {
    expect(instrumentsMatching("cellista")).toEqual(["cello"]);
    expect(instrumentsMatching("necesito")).toEqual([]);
    const voices = instrumentsMatching("voz");
    expect(voices).toEqual(expect.arrayContaining(["voice", "soprano", "mezzo-soprano", "tenor", "baritone", "bass-voice"]));
    expect(voices).not.toContain("cello");
    expect(instrumentsMatching("cuerda")).toEqual(expect.arrayContaining(["violin", "viola", "cello", "double-bass"]));
    expect(instrumentsMatching("vio")).toEqual(expect.arrayContaining(["violin", "viola", "cello"]));
    expect(instrumentsMatching("nyck", ["nyckelharpa"])).toEqual(["nyckelharpa"]);
    expect(instrumentsMatching("")).toEqual([]);
  });
});
