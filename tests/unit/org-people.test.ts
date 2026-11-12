import { describe, expect, it } from "vitest";
import { deciderOf, flagBorderClass, personFlags, sameName } from "@/lib/organizations/people";
import { readProfile } from "@/lib/organizations/profile";

const profile = readProfile({
  summary: "A presenter.",
  booking: { fit: "high", pitchTo: { name: "Mary Brabec", role: "Talent Buyer" } },
  contacts: [{ name: "Ann Lee", relation: "talked", email: "ann@hall.org" }],
});

describe("organization people", () => {
  it("matches names ignoring titles, middle initials and accents", () => {
    expect(sameName("Dr. John V. Sinclair", "John Sinclair")).toBe(true);
    expect(sameName("José Pérez", "Jose Perez")).toBe(true);
    expect(sameName("John Sinclair", "Jane Sinclair")).toBe(false);
    expect(sameName("Admissions", "Admissions")).toBe(false);
  });

  it("takes the decider from booking.pitchTo", () => {
    expect(deciderOf(profile)).toEqual({ name: "Mary Brabec", role: "Talent Buyer", email: undefined });
    expect(deciderOf(null)).toBeNull();
  });

  it("flags who decides and who is talking", () => {
    expect(personFlags({ name: "Mary Brabec", lastInboundAt: null }, profile)).toEqual({ decides: true, talking: false });
    expect(personFlags({ name: "Bob Roe", lastInboundAt: "2026-11-01" }, profile)).toEqual({ decides: false, talking: true });
    expect(personFlags({ name: "Someone", emails: ["ann@hall.org"] }, profile)).toEqual({ decides: false, talking: true });
    expect(personFlags({ name: "Lynn Anderson" }, profile)).toEqual({ decides: false, talking: false });
  });

  it("colors decides over talking", () => {
    expect(flagBorderClass({ decides: true, talking: true })).toContain("amber");
    expect(flagBorderClass({ decides: false, talking: true })).toContain("emerald");
    expect(flagBorderClass({ decides: false, talking: false })).toBeNull();
  });
});
