import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, safeEqual } from "@/lib/crypto";
import { createSessionToken, verifySessionToken } from "@/lib/session";
import { addDays, daysBetween, formatDue, todayIn } from "@/lib/dates";
import { domainOf, normalizeTag, splitList } from "@/lib/utils";

describe("crypto", () => {
  it("round-trips and detects tampering", () => {
    const enc = encryptSecret("1//refresh-token");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe("1//refresh-token");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("compares in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});

describe("session", () => {
  it("accepts its own tokens and rejects others", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
    expect(await verifySessionToken(token, "another-secret-another-secret-12345")).toBe(false);
    expect(await verifySessionToken("garbage")).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
  });
});

describe("dates", () => {
  it("computes today in a timezone", () => {
    const utcLateEvening = new Date("2026-09-30T02:30:00Z");
    expect(todayIn("America/New_York", utcLateEvening)).toBe("2026-09-29");
    expect(todayIn("Europe/Paris", utcLateEvening)).toBe("2026-09-30");
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(daysBetween("2026-09-01", "2026-09-30")).toBe(29);
    expect(formatDue("2026-09-28", "2026-09-30")).toBe("Overdue 2d");
    expect(formatDue("2026-09-30", "2026-09-30")).toBe("Today");
    expect(formatDue("2026-10-01", "2026-09-30")).toBe("Tomorrow");
  });
});

describe("utils", () => {
  it("splits, normalizes and extracts", () => {
    expect(splitList("a, b ,, A\nc")).toEqual(["a", "b", "c"]);
    expect(normalizeTag("  Art Fair ")).toBe("art-fair");
    expect(domainOf("Jane@MoMA.org")).toBe("moma.org");
  });
});
