import { describe, expect, it } from "vitest";
import { repairMojibake } from "@/lib/text/mojibake";

const asLatin = (text: string, charset: string) => new TextDecoder(charset).decode(new TextEncoder().encode(text));

describe("repairMojibake", () => {
  it("restores UTF-8 text that was read as windows-1252 or iso-8859-2", () => {
    const spanish = "Buenos días, Guillermo: está previsto que se resuelva la concesión. ¿Añadimos algo? “Sí” – €50";
    expect(asLatin(spanish, "windows-1252")).toContain("dÃ­as");
    expect(repairMojibake(asLatin(spanish, "windows-1252"))).toBe(spanish);
    expect(repairMojibake(asLatin("Klemen Ramovš, Brežice", "iso-8859-2"))).toBe("Klemen Ramovš, Brežice");
  });

  it("leaves correct text alone", () => {
    for (const text of ["Café mañana", "Århus Ålborg", "Łódź, święto", "Ärger über Öl", "Plain ASCII", "Ç'est déjà là"]) {
      expect(repairMojibake(text)).toBe(text);
    }
  });

  it("repairs the broken runs and keeps correct characters next to them", () => {
    expect(repairMojibake("Gracias — la concesiÃ³n llegará")).toBe("Gracias — la concesión llegará");
  });
});
