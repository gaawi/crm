import { describe, expect, it } from "vitest";
import { parseBuyerList } from "@/lib/guests/parse-list";

describe("parseBuyerList", () => {
  it("reads names with counts in several shapes", () => {
    expect(
      parseBuyerList("Name, Qty\nAna López, 2\nJohn Smith\tjohn@x.com\t3\nMaria Ruiz x2\nTom (4)\n\nLee; lee@y.org"),
    ).toEqual([
      { name: "Ana López", email: null, tickets: 2 },
      { name: "John Smith", email: "john@x.com", tickets: 3 },
      { name: "Maria Ruiz", email: null, tickets: 2 },
      { name: "Tom", email: null, tickets: 4 },
      { name: "Lee", email: "lee@y.org", tickets: 1 },
    ]);
  });

  it("joins first and last name columns and skips headers", () => {
    expect(parseBuyerList("First name\tLast name\tEmail\tQuantity\nAna\tLópez\tANA@X.COM\t2")).toEqual([
      { name: "Ana López", email: "ana@x.com", tickets: 2 },
    ]);
  });

  it("keeps an email-only line and caps tickets", () => {
    expect(parseBuyerList("someone@z.com, 50")).toEqual([{ name: "someone@z.com", email: "someone@z.com", tickets: 20 }]);
  });
});
