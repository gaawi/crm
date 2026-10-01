import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { addSheetRow, createSheet, getSheetRows, listSheets, updateSheetRow } from "@/lib/queries/booking";
import { getContactByEmail } from "@/lib/queries/contacts";
import { useTestDatabase } from "../setup/db";

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("booking sheets", () => {
  useTestDatabase();

  it("adds venues with their organization, contact and booking deal", async () => {
    const sheet = await createSheet({ name: "Gira España 2027", currency: "EUR" });
    const row = await addSheetRow({
      projectId: sheet,
      organization: "Teatro Campoamor",
      city: "Oviedo",
      contactName: "Ana López",
      role: "Programación",
      email: "Ana@Campoamor.es",
      eventDates: "Spring 2027",
      fee: "4.500",
      followUpAt: "2026-10-01",
      nextStep: "Send dossier",
    });
    const [r] = await getSheetRows(sheet);
    expect(r).toMatchObject({
      id: row,
      stage: "lead",
      currency: "EUR",
      eventDates: "Spring 2027",
      nextStep: "Send dossier",
      organization: { name: "Teatro Campoamor", city: "Oviedo" },
      contact: { displayName: "Ana López", role: "Programación", email: "ana@campoamor.es" },
    });
    const contact = await getContactByEmail("ana@campoamor.es");
    expect(contact?.organization?.name).toBe("Teatro Campoamor");
    expect(contact?.projects.map((p) => p.name)).toEqual(["Gira España 2027"]);

    const [listed] = await listSheets("2026-10-01");
    expect(listed).toMatchObject({ name: "Gira España 2027", rows: 1, open: 1, followUpsDue: 1, currency: "EUR" });
  });

  it("reuses an existing contact and organization", async () => {
    const sheet = await createSheet({ name: "Booking USA" });
    await addSheetRow({ projectId: sheet, organization: "Fontana Chamber Arts", email: "svdw@fontanamusic.org", contactName: "Sophié" });
    await addSheetRow({ projectId: sheet, organization: "fontana chamber arts", email: "SVDW@fontanamusic.org" });
    const [{ orgs }] = await sql<{ orgs: number }[]>`select count(*)::int as orgs from organizations`;
    const [{ contacts }] = await sql<{ contacts: number }[]>`select count(*)::int as contacts from contacts`;
    expect({ orgs, contacts }).toEqual({ orgs: 1, contacts: 1 });
    expect(await getSheetRows(sheet)).toHaveLength(2);
  });

  it("edits cells and orders rows by progress", async () => {
    const sheet = await createSheet({ name: "Festival ADAR · salas" });
    const a = await addSheetRow({ projectId: sheet, organization: "A" });
    const b = await addSheetRow({ projectId: sheet, organization: "B" });
    await updateSheetRow(b, { stage: "negotiation", eventDates: "Aug 2027", fee: "1200" });
    await updateSheetRow(a, { stage: "lost", notes: "No budget this year" });
    const rows = await getSheetRows(sheet);
    expect(rows.map((r) => [r.title, r.stage])).toEqual([
      ["B", "negotiation"],
      ["A", "lost"],
    ]);
    expect(rows[0]).toMatchObject({ eventDates: "Aug 2027", value: "1200.00" });
    const [listed] = await listSheets("2026-10-01");
    expect(listed).toMatchObject({ open: 1, declined: 1 });
  });

  it("refuses rows for projects that are not sheets", async () => {
    const [{ id }] = await sql<{ id: string }[]>`select id from projects where name = 'ADAR'`;
    await expect(addSheetRow({ projectId: id, organization: "X" })).rejects.toThrow(/not found/);
  });
});
