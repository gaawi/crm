import { describe, expect, it } from "vitest";
import { filterRows, groupBySection, NO_SECTION, sheetFiltersFromParams, sheetFiltersToQuery, sheetSections, type FilterRow } from "@/lib/booking/filters";
import { callFollowUpPreset, followUpTiming, isFollowUpDue, isNoReply, lastTouch, rowFollowUpTiming } from "@/lib/booking/timing";
import { toDateTimeLocal, zonedDateTimeToUtc } from "@/lib/dates";

const tz = "Europe/Madrid";

describe("followUpTiming", () => {
  it("waits 5 days, then it is a good time, and after 10 it is overdue", () => {
    const at = (iso: string) => followUpTiming({ awaitingReplySince: iso, today: "2026-10-10", timezone: tz });
    expect(at("2026-10-08T10:00:00Z")).toEqual({ state: "wait", days: 2, waitDays: 3, suggestedDate: "2026-10-13" });
    expect(at("2026-10-05T10:00:00Z")).toMatchObject({ state: "ready", days: 5, waitDays: 0 });
    expect(at("2026-09-30T10:00:00Z")).toMatchObject({ state: "ready", days: 10 });
    expect(at("2026-09-29T10:00:00Z")).toMatchObject({ state: "overdue", days: 11, suggestedDate: "2026-10-04" });
    expect(followUpTiming({ awaitingReplySince: null, today: "2026-10-10", timezone: tz })).toBeNull();
  });

  it("counts the owner's calendar days", () => {
    // 23:30 UTC on Oct 4 is Oct 5 in Madrid.
    expect(followUpTiming({ awaitingReplySince: new Date("2026-10-04T23:30:00Z"), today: "2026-10-10", timezone: tz })?.days).toBe(5);
  });

  it("only applies to Contacted / Offer sent rows", () => {
    const contact = { awaitingReplySince: "2026-09-01T10:00:00Z", lastInboundAt: null, lastOutboundAt: "2026-09-01T10:00:00Z" };
    const row = { stage: "contacted" as const, followUpAt: null, contact, lastActivity: null };
    expect(rowFollowUpTiming(row, "2026-10-10", tz)?.state).toBe("overdue");
    expect(isNoReply(row, "2026-10-10", tz)).toBe(true);
    expect(rowFollowUpTiming({ ...row, stage: "negotiation" }, "2026-10-10", tz)).toBeNull();
    expect(isFollowUpDue({ stage: "lead", followUpAt: "2026-10-10" }, "2026-10-10")).toBe(true);
    expect(isFollowUpDue({ stage: "won", followUpAt: "2026-10-01" }, "2026-10-10")).toBe(false);
  });

  it("suggests when to call again", () => {
    expect(callFollowUpPreset("no_answer", "2026-10-01")).toEqual({ followUpAt: "2026-10-03", nextStep: "Call again" });
    expect(callFollowUpPreset("voicemail", "2026-10-01")).toEqual({ followUpAt: "2026-10-03", nextStep: "Call again" });
    expect(callFollowUpPreset("call_back", "2026-10-01")).toEqual({ followUpAt: "2026-10-02", nextStep: "Call back" });
    expect(callFollowUpPreset("reached", "2026-10-01")).toBeNull();
  });

  it("finds the last touch", () => {
    const contact = { awaitingReplySince: "2026-09-20T10:00:00Z", lastInboundAt: "2026-09-10T10:00:00Z", lastOutboundAt: "2026-09-20T10:00:00Z" };
    expect(lastTouch({ contact, lastActivity: null })).toEqual({ type: "awaiting", at: "2026-09-20T10:00:00.000Z" });
    const call = { kind: "call" as const, outcome: "reached" as const, occurredAt: "2026-09-22T10:00:00Z" };
    expect(lastTouch({ contact, lastActivity: call })).toMatchObject({ type: "activity", kind: "call", outcome: "reached" });
    expect(lastTouch({ contact: { ...contact, awaitingReplySince: null }, lastActivity: null })).toMatchObject({ type: "email_out" });
    expect(lastTouch({ contact: { ...contact, lastInboundAt: "2026-09-25T10:00:00Z", awaitingReplySince: null }, lastActivity: call })).toMatchObject({
      type: "email_in",
    });
    expect(lastTouch({ contact: null, lastActivity: null })).toBeNull();
  });
});

describe("datetime-local in the owner's timezone", () => {
  it("round-trips", () => {
    expect(zonedDateTimeToUtc("2026-10-01T14:30", tz)?.toISOString()).toBe("2026-10-01T12:30:00.000Z");
    expect(zonedDateTimeToUtc("2026-12-01T09:00", "America/New_York")?.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(zonedDateTimeToUtc("2026-12-01T09:00:00Z", tz)?.toISOString()).toBe("2026-12-01T09:00:00.000Z");
    expect(zonedDateTimeToUtc("2026-02-30T10:00", tz)).toBeNull();
    expect(zonedDateTimeToUtc("yesterday", tz)).toBeNull();
    expect(toDateTimeLocal(new Date("2026-10-01T12:30:00Z"), tz)).toBe("2026-10-01T14:30");
  });
});

describe("sheet filters and sections", () => {
  const row = (patch: Partial<FilterRow> & { createdAt?: string } = {}): FilterRow & { createdAt: string } => ({
    title: "Venue",
    stage: "lead",
    followUpAt: null,
    notes: null,
    section: null,
    spaces: null,
    returning: false,
    organization: { name: "Teatro Campoamor", city: "Oviedo" },
    contact: {
      displayName: "Ana López",
      role: "Programación",
      email: "ana@campoamor.es",
      phone: "+34612345678",
      whatsapp: null,
      awaitingReplySince: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },
    lastActivity: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...patch,
  });

  it("searches without accents and by phone digits", () => {
    const rows = [row(), row({ organization: { name: "Auditorio de Gijón", city: "Gijón" }, contact: null, notes: "Sala grande" })];
    const f = (q: string) => filterRows(rows, { q, status: "", section: "", flags: [] }, "2026-10-01", tz).length;
    expect(f("gijon")).toBe(1);
    expect(f("ANA lópez")).toBe(1);
    expect(f("612 345")).toBe(1);
    expect(f("sala")).toBe(1);
    expect(f("")).toBe(2);
    expect(f("nothing")).toBe(0);
  });

  it("filters by status, section and flags", () => {
    const rows = [
      row({ stage: "negotiation", section: "Cultura en Rede", returning: true }),
      row({ stage: "lead", followUpAt: "2026-09-30" }),
      row({ stage: "lead", contact: null }),
    ];
    const f = (filters: Partial<Parameters<typeof filterRows>[1]>) =>
      filterRows(rows, { q: "", status: "", section: "", flags: [], ...filters }, "2026-10-01", tz).length;
    expect(f({ status: "lead" })).toBe(2);
    expect(f({ section: "Cultura en Rede" })).toBe(1);
    expect(f({ section: NO_SECTION })).toBe(2);
    expect(f({ flags: ["due"] })).toBe(1);
    expect(f({ flags: ["returning", "hot"] })).toBe(1);
    expect(f({ flags: ["phone"] })).toBe(2);
  });

  it("filters by goal (rows without a kind count as booking) and keeps it in the URL", () => {
    const rows = [row({ kind: "venue" }), row({ kind: "booking" }), row()];
    const f = (kind: "" | "venue" | "booking" | "press") =>
      filterRows(rows, { q: "", status: "", kind, section: "", flags: [] }, "2026-10-01", tz).length;
    expect(f("")).toBe(3);
    expect(f("venue")).toBe(1);
    expect(f("booking")).toBe(2);
    expect(f("press")).toBe(0);
    expect(sheetFiltersFromParams(new URLSearchParams("goal=venue")).kind).toBe("venue");
    expect(sheetFiltersFromParams(new URLSearchParams("goal=bogus")).kind).toBeUndefined();
    expect(sheetFiltersToQuery({ q: "", status: "", kind: "venue", section: "", flags: [] })).toBe("?goal=venue");
  });

  it("reads and writes the URL", () => {
    const filters = sheetFiltersFromParams(new URLSearchParams("q=gijon&status=won&section=Internacional&flag=due,bogus,no_reply"));
    expect(filters).toEqual({ q: "gijon", status: "won", section: "Internacional", flags: ["due", "no_reply"] });
    expect(sheetFiltersToQuery(filters)).toBe("?q=gijon&status=won&section=Internacional&flag=due%2Cno_reply");
    expect(sheetFiltersFromParams({ status: "bogus" }).status).toBe("");
    expect(sheetFiltersToQuery({ q: " ", status: "", section: "", flags: [] })).toBe("");
  });

  it("groups by section in the order sections were first used", () => {
    const rows = [
      row({ title: "a", section: "Otros espacios", createdAt: "2026-09-03T00:00:00.000Z" }),
      row({ title: "b", section: null, createdAt: "2026-09-01T00:00:00.000Z" }),
      row({ title: "c", section: "Internacional", createdAt: "2026-09-02T00:00:00.000Z" }),
      row({ title: "d", section: "Otros espacios", createdAt: "2026-09-01T12:00:00.000Z" }),
    ];
    expect(groupBySection(rows).map((g) => [g.section, g.rows.map((r) => r.title)])).toEqual([
      ["Otros espacios", ["a", "d"]],
      ["Internacional", ["c"]],
      [null, ["b"]],
    ]);
    expect(sheetSections(rows)).toEqual(["Otros espacios", "Internacional"]);
    expect(groupBySection([row({ title: "x" })]).map((g) => g.section)).toEqual([null]);
  });
});
