import { describe, expect, it } from "vitest";
import { filterRows, sheetFiltersFromParams, sheetFiltersToQuery, EMPTY_FILTERS } from "@/lib/booking/filters";
import { sectionSummary } from "@/lib/booking/section-summary";

type Row = Parameters<typeof filterRows>[0][number];
const row = (stage: string, tags: string[], fit?: string) =>
  ({
    title: "x",
    notes: null,
    section: "S",
    spaces: null,
    returning: false,
    stage,
    followUpAt: null,
    contact: null,
    organization: { name: "Org", city: null, tags, profile: fit ? { booking: { fit } } : null },
  }) as unknown as Row;

const rows = [row("lead", ["vip", "chamber-specialist"], "high"), row("lead", ["nyc-under-5h"], "medium"), row("contacted", [], "low"), row("lead", [])];

describe("sheet sections and organization filters", () => {
  it("summarizes a section", () => {
    const label = (s: string) => (s === "lead" ? "To contact" : s === "contacted" ? "Contacted" : s);
    expect(sectionSummary(rows as never, label as never)).toBe("3 to contact · 1 contacted · 1 VIP · 1 high fit · 1 < 5 h NYC");
  });

  it("filters VIP, near NYC and chamber specialists", () => {
    const f = (flags: string) => filterRows(rows, { ...EMPTY_FILTERS, flags: flags.split(",") as never }, "2026-11-12", "America/New_York").length;
    expect(f("vip")).toBe(1);
    expect(f("near_nyc")).toBe(1);
    expect(f("chamber")).toBe(1);
  });

  it("filters by fit and keeps it in the URL", () => {
    const by = (fit: string) => filterRows(rows, { ...EMPTY_FILTERS, fit: fit as never }, "2026-11-12", "America/New_York").length;
    expect(by("high")).toBe(1);
    expect(by("high_medium")).toBe(2);
    expect(by("low")).toBe(1);
    expect(by("unknown")).toBe(1);
    const parsed = sheetFiltersFromParams(new URLSearchParams("fit=high_medium&flag=vip,near_nyc"));
    expect(parsed.fit).toBe("high_medium");
    expect(sheetFiltersToQuery(parsed)).toBe("?flag=vip%2Cnear_nyc&fit=high_medium");
  });
});

describe("Josefina 2025 filter", () => {
  it("matches the josefina-2025 organization tag", () => {
    const r = [row("lead", ["josefina-2025"]), row("lead", [])];
    expect(filterRows(r, { ...EMPTY_FILTERS, flags: ["josefina"] }, "2026-11-13", "America/New_York").length).toBe(1);
  });
});
