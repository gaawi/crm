import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, normalizePrefix, telHref, whatsappNumber, whatsappUrl } from "@/lib/booking/phone";

describe("normalizePhone", () => {
  it.each([
    ["612 34 56 78", undefined, "612345678"],
    ["612 34 56 78", "+34", "+34612345678"],
    ["(985) 12.34.56", "+34", "+34985123456"],
    ["0034 612-345-678", "+1", "+34612345678"],
    ["++34 612 345 678", null, "+34612345678"],
    ["34 612 345 678", "+34", "+34612345678"],
    ["(212) 555-0100", "+1", "+12125550100"],
    ["1 212 555 0100", "+1", "+12125550100"],
    ["07700 900123", "+44", "+447700900123"],
    ["06 1234 5678", "+39", "+390612345678"],
    ["612 345 678", "0034", "+34612345678"],
    ["  +33 6 12 34 56 78 ", "+34", "+33612345678"],
  ])("%s (prefix %s) → %s", (raw, prefix, expected) => {
    expect(normalizePhone(raw, prefix)).toBe(expected);
  });

  it.each(["", "   ", "12345", "call me", "612 345 678 ext 2", "+34 6+12", "12345678901234567", null, undefined])("rejects %s", (raw) => {
    expect(normalizePhone(raw as string | null | undefined, "+34")).toBeNull();
  });

  it("normalizes prefixes", () => {
    expect(normalizePrefix("34")).toBe("+34");
    expect(normalizePrefix("0034")).toBe("+34");
    expect(normalizePrefix("+1")).toBe("+1");
    expect(normalizePrefix("+12345")).toBeNull();
    expect(normalizePrefix("ES")).toBeNull();
    expect(normalizePrefix("")).toBeNull();
  });
});

describe("phone links", () => {
  it("only lets digits and + into tel: links", () => {
    expect(telHref("+34612345678")).toBe("tel:+34612345678");
    expect(telHref("612 345 678")).toBe("tel:612345678");
    expect(telHref("javascript:alert(1)")).toBeNull();
    expect(telHref("612345678\nX")).toBeNull();
    expect(telHref(null)).toBeNull();
  });

  it("opens WhatsApp for the WhatsApp number, Spanish mobiles and other international numbers", () => {
    expect(whatsappUrl({ whatsapp: "+34699111222", phone: "+34985123456" })).toBe("https://wa.me/34699111222");
    expect(whatsappUrl({ phone: "+34612345678" })).toBe("https://wa.me/34612345678");
    expect(whatsappUrl({ phone: "+34712345678" })).toBe("https://wa.me/34712345678");
    expect(whatsappUrl({ phone: "+34985123456" })).toBeNull(); // Spanish landline
    expect(whatsappUrl({ phone: "+12125550100" })).toBe("https://wa.me/12125550100");
    expect(whatsappUrl({ phone: "612345678" })).toBeNull(); // no country code
    expect(whatsappUrl({ whatsapp: "<script>", phone: null })).toBeNull();
    expect(whatsappUrl(null)).toBeNull();
    expect(whatsappNumber({ phone: "+34612345678" })).toBe("+34612345678");
  });

  it("formats for display", () => {
    expect(formatPhone("+34612345678")).toBe("+34 612 345 678");
    expect(formatPhone("+12125550100")).toBe("+1 212 555 0100");
    expect(formatPhone("985123456")).toBe("985 123 456");
    expect(formatPhone("+447700900123")).toBe("+44 770 090 0123");
    expect(formatPhone("+351912345678")).toBe("+351 912 345 678");
    expect(formatPhone("+33612345678")).toBe("+33 612 345 678");
    expect(formatPhone("+34985123")).toBe("+34 985 123");
    expect(formatPhone("612345")).toBe("612345");
    expect(formatPhone(null)).toBe("");
  });
});
