import { describe, expect, it } from "vitest";
import { httpsUrlIssue, normalizeHttpsUrl, PHOTO_URL_MAX, safePhotoUrl } from "@/lib/contacts/photo";
import { campaignOptions, countByCampaign, inCampaign } from "@/lib/today/campaign-filter";
import nextConfig from "@/next.config";

describe("contact photo URLs", () => {
  it("accepts https image URLs and normalizes them", () => {
    expect(httpsUrlIssue("https://example.org/team/ana.jpg")).toBeNull();
    expect(normalizeHttpsUrl("  https://Example.org/a b".replace(" b", "%20b"))).toBe("https://example.org/a%20b");
    expect(safePhotoUrl("https://cdn.example.org/x.png?w=200")).toBe("https://cdn.example.org/x.png?w=200");
  });

  it("rejects anything that is not a plain https URL", () => {
    for (const bad of [
      "http://example.org/a.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//example.org/a.jpg",
      "/local.jpg",
      "https://user:pass@example.org/a.jpg",
      "https://example.org/a b.jpg",
      "",
      "   ",
      null,
      42,
      `https://example.org/${"a".repeat(PHOTO_URL_MAX)}`,
    ]) {
      expect(httpsUrlIssue(bad), String(bad)).not.toBeNull();
      expect(normalizeHttpsUrl(bad)).toBeNull();
    }
    expect(safePhotoUrl(null)).toBeNull();
    expect(safePhotoUrl("http://example.org/a.jpg")).toBeNull();
  });
});

describe("Today campaign filter", () => {
  it("keeps everything under All and only the campaign's items otherwise", () => {
    expect(inCampaign(undefined, null)).toBe(true);
    expect(inCampaign(["a"], null)).toBe(true);
    expect(inCampaign(["a", "b"], "b")).toBe(true);
    expect(inCampaign(["a"], "b")).toBe(false);
    expect(inCampaign(undefined, "b")).toBe(false);
  });

  it("counts items per campaign and orders the options", () => {
    const counts = countByCampaign([["a"], ["a", "b"], undefined, ["b", "b"], ["c"]]);
    expect(Object.fromEntries(counts)).toEqual({ a: 2, b: 2, c: 1 });
    const options = campaignOptions(
      [
        { id: "z", name: "Zero" },
        { id: "c", name: "C" },
        { id: "a", name: "A" },
      ],
      new Map([
        ["a", 3],
        ["c", 1],
      ]),
    );
    expect(options).toEqual([
      { id: "a", name: "A", count: 3 },
      { id: "c", name: "C", count: 1 },
      { id: "z", name: "Zero", count: 0 },
    ]);
  });
});

describe("Campaigns routes", () => {
  it("permanently redirects the old /booking links to /campaigns", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "/booking", destination: "/campaigns", permanent: true }),
        expect.objectContaining({ source: "/booking/:path*", destination: "/campaigns/:path*", permanent: true }),
      ]),
    );
  });
});
