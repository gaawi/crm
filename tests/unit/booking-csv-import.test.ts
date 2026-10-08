import { describe, expect, it } from "vitest";
import {
  IMPORT_MAX_ROWS,
  normalizeHeader,
  parseImportDate,
  parseImportKind,
  parseImportNextAction,
  parseImportStage,
  parseSheetImport,
} from "@/lib/booking/csv-import";

describe("parseSheetImport", () => {
  it("reads semicolon CSV with Spanish headers, quotes, BOM and CRLF", () => {
    const text =
      "﻿Municipio;Concejo;Contacto;Cargo;Correo;Teléfono;Sección;Estado;Caché;Seguimiento;Previo;Notas\r\n" +
      'Valdediós;Villaviciosa;"Sra. Ana López";Concejala;ana@villaviciosa.es, info@villaviciosa.es;985 89 17 50 / 600 111 222;Cultura en Rede;Email enviado;"1.200 €";15/10/2026;Sí;"Dice ""sí""\r\nen otoño"\r\n' +
      "Colunga;;;;;;;Pendiente;;;;\r\n";
    const result = parseSheetImport(text);
    expect(result.delimiter).toBe(";");
    expect(result.columns).toEqual([
      "organization",
      "city",
      "contactName",
      "role",
      "email",
      "phone",
      "section",
      "stage",
      "fee",
      "followUpAt",
      "returning",
      "notes",
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      line: 2,
      organization: "Valdediós",
      city: "Villaviciosa",
      contactName: "Sra. Ana López",
      role: "Concejala",
      email: "ana@villaviciosa.es",
      phone: "985 89 17 50",
      section: "Cultura en Rede",
      stage: "contacted",
      fee: "1200",
      followUpAt: "2026-10-15",
      returning: true,
    });
    expect(result.rows[0].notes).toBe('Dice "sí"\nen otoño\nOther emails: info@villaviciosa.es\nOther phones: 600 111 222');
    expect(result.rows[1]).toMatchObject({ line: 4, organization: "Colunga", stage: "lead", notes: null });
    expect(result.rows[1].email).toBeUndefined();
  });

  it("reads tab-separated text pasted from a spreadsheet, English headers", () => {
    const text = "Venue\tCity\tEmail\tPhone\tWhatsApp\tStatus\tFee (EUR)\tFollow-up\tReturning\tSpaces\nTeatro Jovellanos\tGijón\tTJ@Gijon.es\t+34 985 18 29 29\t612345678\tIn conversation\t4,500\t2026-11-02\tno\tSala principal, Sala B\n";
    const result = parseSheetImport(text);
    expect(result.delimiter).toBe("\t");
    expect(result.rows[0]).toMatchObject({
      organization: "Teatro Jovellanos",
      city: "Gijón",
      email: "tj@gijon.es",
      phone: "+34 985 18 29 29",
      whatsapp: "612345678",
      stage: "negotiation",
      fee: "4500",
      followUpAt: "2026-11-02",
      returning: false,
      spaces: "Sala principal, Sala B",
    });
  });

  it("re-imports the sheet's own CSV export", () => {
    const text =
      '"Venue / presenter","Section","City","Spaces","Returning","Contact","Role","Email","Phone","WhatsApp","Status","Last contact","Last activity","Follow up","Next step","Dates","Fee (USD)","Notes","History"\r\n' +
      '"Fontana","Internacional","Seattle","","Yes","Sophie","Director","svdw@fontana.org","\'+12065550100","","Offer sent","2026-09-01","","2026-10-03","Call","May 2027","2500.00","","2026-09-01 Call (Talked)"\r\n';
    const result = parseSheetImport(text);
    expect(result.ignored).toEqual(["Last contact", "Last activity", "History"]);
    expect(result.rows[0]).toMatchObject({
      organization: "Fontana",
      section: "Internacional",
      returning: true,
      contactName: "Sophie",
      stage: "proposal",
      followUpAt: "2026-10-03",
      nextStep: "Call",
      eventDates: "May 2027",
      fee: "2500.00",
    });
    // The export's formula guard (') is not a phone: kept in the notes.
    expect(result.rows[0].phone).toBeUndefined();
    expect(result.rows[0].notes).toBe("Phone: '+12065550100");
  });

  it("keeps what it cannot read in the notes and reports rows without a venue", () => {
    const text = "Organization,Email,Status,Fee,Follow up,Phone\n,a@b.es,,,,\nSala X,not-an-email,Maybe later,a convenir,next week,call me\n";
    const result = parseSheetImport(text);
    expect(result.errors).toEqual([{ line: 2, message: "No venue / presenter name." }]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].email).toBeUndefined();
    expect(result.rows[0].stage).toBeUndefined();
    expect(result.rows[0].notes).toBe(
      "Email (not valid): not-an-email\nPhone: call me\nStatus: Maybe later\nFee: a convenir\nFollow up: next week",
    );
  });

  it("reads Municipio as the city when a Sala column names the venue", () => {
    const withSala = parseSheetImport("Sala;Municipio;Email\nTeatro Riera;Villaviciosa;a@riera.es\n");
    expect(withSala.columns).toEqual(["organization", "city", "email"]);
    expect(withSala.rows[0]).toMatchObject({ organization: "Teatro Riera", city: "Villaviciosa" });
    // With a city column too, the first venue column wins and Municipio is skipped.
    const withCity = parseSheetImport("Municipio;Sala;Localidad\nVillaviciosa;Teatro Riera;Villaviciosa\n");
    expect(withCity.columns).toEqual(["organization", "city"]);
    expect(withCity.rows[0]).toMatchObject({ organization: "Villaviciosa", city: "Villaviciosa" });
  });

  it("needs a venue column", () => {
    const result = parseSheetImport("Nombre,Correo\nAna,ana@x.es\n");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toMatchObject({ line: 1 });
    expect(parseSheetImport("   \n\n").errors[0]).toMatchObject({ line: 0 });
  });

  it("caps rows and size", () => {
    const many = `Venue\n${Array.from({ length: IMPORT_MAX_ROWS + 5 }, (_, i) => `V${i}`).join("\n")}`;
    const result = parseSheetImport(many);
    expect(result.rows).toHaveLength(IMPORT_MAX_ROWS);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/1000 rows/);
    const huge = parseSheetImport(`Venue\n${"x".repeat(1_000_001)}`);
    expect(huge.rows).toEqual([]);
    expect(huge.errors[0].message).toMatch(/1 MB/);
  });

  it("reads the next action and the goal, in Spanish or English", () => {
    const text = [
      "Sala;Acción;Siguiente paso;Objetivo;Estado",
      "Teatro A;Llamar;;Concierto;",
      "Teatro B;Enviar propuesta completa;;Cesión de espacio;Concedido",
      "Teatro C;Firmar el contrato en Oviedo;Antes del 15;Prensa;Granted",
      "Teatro D;Mantener informado;;Donación;",
      "Teatro E;Send dossier / video;;Get booked;",
      "Teatro F;Bailar;;Algo raro;",
    ].join("\n");
    const { rows, ignored } = parseSheetImport(text);
    expect(ignored).toEqual([]);
    expect(rows.map((r) => [r.organization, r.nextAction ?? null, r.nextStep ?? null, r.kind ?? null])).toEqual([
      ["Teatro A", "call", null, "booking"],
      ["Teatro B", "send_proposal", "Enviar propuesta completa", "venue"],
      ["Teatro C", "close_contract", "Antes del 15", "press"],
      ["Teatro D", "keep_informed", null, "fundraising"],
      ["Teatro E", "send_materials", null, "booking"],
      ["Teatro F", null, "Bailar", null],
    ]);
    expect(rows[2].notes).toBe("Next action: Firmar el contrato en Oviedo");
    expect(rows[5].notes).toBe("Goal: Algo raro");
    expect(rows[2].stage).toBe("won"); // "Granted" reads back as its stage
    expect(rows[1].stage).toBeUndefined(); // "Concedido" is not a known status
  });

  it("maps next action and goal words", () => {
    expect(parseImportNextAction("Llamar el lunes")).toEqual({ action: "call", exact: false });
    expect(parseImportNextAction("llamar")).toEqual({ action: "call", exact: true });
    expect(parseImportNextAction("Call")).toEqual({ action: "call", exact: true });
    expect(parseImportNextAction("send_proposal")).toEqual({ action: "send_proposal", exact: true });
    expect(parseImportNextAction("Propuesta")?.action).toBe("send_proposal");
    expect(parseImportNextAction("Enviar contrato")?.action).toBe("send_contract");
    expect(parseImportNextAction("Cerrar contrato")?.action).toBe("close_contract");
    expect(parseImportNextAction("Seguimiento")?.action).toBe("follow_up");
    expect(parseImportNextAction("Informar de novedades")?.action).toBe("keep_informed");
    expect(parseImportNextAction("Esperar respuesta")?.action).toBe("wait_reply");
    expect(parseImportNextAction("Reunión")?.action).toBe("meeting");
    expect(parseImportNextAction("Mandar vídeo")?.action).toBe("send_materials");
    expect(parseImportNextAction("Wait for their reply")).toEqual({ action: "wait_reply", exact: true });
    expect(parseImportNextAction("")).toBeNull();
    expect(parseImportKind("Subvención")).toBe("grant");
    expect(parseImportKind("Press coverage")).toBe("press");
    expect(parseImportKind("perform_with")).toBe("perform_with");
    expect(parseImportKind("Patrocinio")).toBe("sponsorship");
    expect(parseImportStage("Published")).toBe("won");
    expect(parseImportStage("To pitch")).toBe("lead");
    expect(parseImportStage("Under review")).toBe("negotiation");
  });

  it("normalizes headers and dates", () => {
    expect(normalizeHeader(" Teléfono (móvil): ")).toBe("telefono");
    expect(normalizeHeader("E-mail")).toBe("e mail");
    expect(parseImportDate("15/10/2026")).toBe("2026-10-15");
    expect(parseImportDate("10/15/2026")).toBe("2026-10-15");
    expect(parseImportDate("5.3.27")).toBe("2027-03-05");
    expect(parseImportDate("31/02/2026")).toBeNull();
    expect(parseImportDate("soon")).toBeNull();
  });
});
