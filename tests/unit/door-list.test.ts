import { describe, expect, it } from "vitest";
import { splitName } from "@/lib/guests/door-list";

describe("splitName", () => {
  it("files people by last name", () => {
    expect(splitName("Ana María López")).toEqual(["López", "Ana María"]);
    expect(splitName("López, Ana")).toEqual(["López", "Ana"]);
    expect(splitName("Tao")).toEqual(["Tao", ""]);
    expect(splitName("someone@z.com")).toEqual(["someone@z.com", ""]);
  });
});
