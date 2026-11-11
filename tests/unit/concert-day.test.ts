import { describe, expect, it } from "vitest";
import { concertsToday } from "@/lib/today/concert-day";

const ny = "America/New_York";
const at = (iso: string) => ({ startsAt: new Date(iso), timeZone: ny });

describe("concertsToday", () => {
  const now = new Date("2026-11-11T15:00:00Z"); // 10am in New York

  it("keeps a concert later today", () => {
    expect(concertsToday([at("2026-11-12T01:00:00Z")], now)).toHaveLength(1); // 8pm Nov 11 in NY
  });

  it("drops yesterday's and tomorrow's", () => {
    expect(concertsToday([at("2026-11-10T23:00:00Z"), at("2026-11-13T00:00:00Z")], now)).toHaveLength(0);
  });

  it("still shows it after it started, until local midnight", () => {
    expect(concertsToday([at("2026-11-12T01:00:00Z")], new Date("2026-11-12T04:30:00Z"))).toHaveLength(1); // 11:30pm NY
    expect(concertsToday([at("2026-11-12T01:00:00Z")], new Date("2026-11-12T05:30:00Z"))).toHaveLength(0); // 12:30am next day
  });
});
