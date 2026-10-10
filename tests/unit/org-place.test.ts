import { describe, expect, it } from "vitest";
import { addressMapsUrl, mapsQueryUrl, mapsSearchUrl, orgPlace, parseVenueLines, venueLine, venueMapsUrl } from "@/lib/organizations/profile";

describe("Google Maps links for an organization's place", () => {
  it("builds an encoded Maps search URL", () => {
    expect(mapsSearchUrl("Kuopio Tanssii ja Soi, Kuopio, Finland")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Kuopio%20Tanssii%20ja%20Soi%2C%20Kuopio%2C%20Finland",
    );
    expect(mapsSearchUrl("Café & Bar #1 / Málaga")).toBe("https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Bar%20%231%20%2F%20M%C3%A1laga");
  });

  it("shows City, Country and searches for the organization there", () => {
    expect(orgPlace({ name: "Kuopio Festival", city: "Helsinki" }, { city: "Kuopio", country: "Finland", location: "Lakeside" })).toEqual({
      label: "Kuopio, Finland",
      city: "Kuopio",
      mapsUrl: mapsSearchUrl("Kuopio Festival, Kuopio, Finland"),
    });
    expect(orgPlace({ name: "Teatro" }, { country: "Spain" })?.label).toBe("Spain");
  });

  it("falls back to the profile's location, then the organization's city", () => {
    expect(orgPlace({ name: "Odeon", city: "Athens" }, { location: "Larisa, Greece" })).toMatchObject({
      label: "Larisa, Greece",
      city: "Larisa",
      mapsUrl: mapsSearchUrl("Odeon, Larisa, Greece"),
    });
    expect(orgPlace({ name: "Teatro Real", city: " Madrid " }, null)).toMatchObject({ label: "Madrid", mapsUrl: mapsSearchUrl("Teatro Real, Madrid") });
    expect(orgPlace({ name: "Nowhere" }, { location: "  " })).toBeNull();
    expect(orgPlace(null, { city: "Kuopio" })?.mapsUrl).toBe(mapsSearchUrl("Kuopio"));
  });

  it("does not repeat a country the city already names", () => {
    expect(orgPlace({ name: "Hall" }, { city: "Kuopio, Finland", country: "Finland" })?.label).toBe("Kuopio, Finland");
  });

  it("links addresses and venues in the profile's city and country", () => {
    const p = { summary: "Hi", city: "Kuopio", country: "Finland", address: "Kuopionlahdenkatu 23" };
    expect(addressMapsUrl(p)).toBe(mapsSearchUrl("Kuopionlahdenkatu 23, Kuopio, Finland"));
    expect(addressMapsUrl({ ...p, address: "Kuopionlahdenkatu 23, 70100 Kuopio" })).toBe(mapsSearchUrl("Kuopionlahdenkatu 23, 70100 Kuopio, Finland"));
    expect(addressMapsUrl({ summary: "Hi" })).toBeNull();
    expect(venueMapsUrl({ name: "Music Centre" }, p)).toBe(mapsSearchUrl("Music Centre, Kuopio, Finland"));
    expect(venueMapsUrl({ name: "Music Centre", address: "Kuopionlahdenkatu 23" }, p)).toBe(mapsSearchUrl("Kuopionlahdenkatu 23, Kuopio, Finland"));
    expect(venueMapsUrl({ name: "Cloister" }, { summary: "Hi", location: "Girona, Spain" })).toBe(mapsSearchUrl("Cloister, Girona, Spain"));
    expect(venueMapsUrl({ name: "Hall" }, { summary: "Hi" }, { city: "Madrid" })).toBe(mapsSearchUrl("Hall, Madrid"));
    expect(mapsQueryUrl([" ", null, undefined])).toBeNull();
  });

  it("reads and writes a venue's address as an @ part", () => {
    const [v] = parseVenueLines("Main hall — black box — 450 — @ Calle Mayor 1");
    expect(v).toEqual({ name: "Main hall", type: "black box", capacity: 450, address: "Calle Mayor 1" });
    expect(venueLine(v)).toBe("Main hall — black box — 450 — @ Calle Mayor 1");
  });
});
