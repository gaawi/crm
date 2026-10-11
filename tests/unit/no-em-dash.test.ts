import { describe, expect, it } from "vitest";
import { noEmDash } from "@/lib/text/no-em-dash";

describe("noEmDash", () => {
  it("turns em dashes into commas, hyphens or nothing", () => {
    expect(noEmDash("Thank you for such a thoughtful reply — I really enjoyed reading it.")).toBe(
      "Thank you for such a thoughtful reply, I really enjoyed reading it.",
    );
    expect(noEmDash("Shipping—handled by us—arrives Monday")).toBe("Shipping, handled by us, arrives Monday");
    expect(noEmDash("— first point\n— second point")).toBe("- first point\n- second point");
    expect(noEmDash("Season 2026—2027")).toBe("Season 2026-2027");
    expect(noEmDash("We'd love to — .")).toBe("We'd love to.");
    expect(noEmDash("Ends with a dash —")).toBe("Ends with a dash");
  });

  it("leaves text without em dashes untouched (en dashes and hyphens too)", () => {
    const text = "Festival ADAR – EFFEA 2027 - Dear Natasha,\n\nBest,";
    expect(noEmDash(text)).toBe(text);
  });
});
