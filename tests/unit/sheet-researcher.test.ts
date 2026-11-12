import { describe, expect, it } from "vitest";
import { researcherOf, rowHasFlag, sheetFiltersFromParams } from "@/lib/booking/filters";

const row = (researchedBy?: string) =>
  ({
    title: "x",
    notes: null,
    section: null,
    spaces: null,
    returning: false,
    stage: "lead",
    followUpAt: null,
    contact: null,
    organization: { name: "Org", city: null, profile: researchedBy ? { researchedBy } : null },
  }) as unknown as Parameters<typeof rowHasFlag>[0];

describe("who researched a campaign row", () => {
  it("reads profile.researchedBy", () => {
    expect(researcherOf({ researchedBy: "claude" })).toBe("claude");
    expect(researcherOf({ researchedBy: "Claude public research 2026-11-12" })).toBe("claude");
    expect(researcherOf({ researchedBy: "ChatGPT official website 2026-11-06" })).toBe("chatgpt");
    expect(researcherOf({ researchedBy: "owner" })).toBeNull();
    expect(researcherOf(null)).toBeNull();
  });

  it("filters by researcher", () => {
    expect(rowHasFlag(row("claude"), "claude", "2026-11-12", "America/New_York")).toBe(true);
    expect(rowHasFlag(row("chatgpt public official research"), "chatgpt", "2026-11-12", "America/New_York")).toBe(true);
    expect(rowHasFlag(row(), "unresearched", "2026-11-12", "America/New_York")).toBe(true);
    expect(rowHasFlag(row("claude"), "unresearched", "2026-11-12", "America/New_York")).toBe(false);
  });

  it("reads the new flags from the URL", () => {
    expect(sheetFiltersFromParams(new URLSearchParams("flag=claude,unresearched")).flags).toEqual(["claude", "unresearched"]);
  });
});
