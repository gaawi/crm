import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ sql: () => [] }));

const { newPart } = await import("@/lib/queries/last-reply");

describe("newPart", () => {
  it("keeps only the new text, without the quoted history", () => {
    const body = "Dear Josefina,\n\nOur season is fully booked.\n\nKind regards,\nGordon\n\nOn Tue, Mar 18, 2025 at 11:43 PM Josefina Urraca <j@x.com> wrote:\n> Dear Gordon,\n> We are planning a tour";
    expect(newPart(body)).toBe("Dear Josefina,\n\nOur season is fully booked.\n\nKind regards,\nGordon");
  });
  it("cuts Spanish and Outlook headers and long texts", () => {
    expect(newPart("Gracias!\n\nEl lun, 3 mar 2025, Ana escribió:\nhola")).toBe("Gracias!");
    expect(newPart("Thanks\n\nFrom: Ana <a@b.c>\nSent: Monday")).toBe("Thanks");
    expect(newPart("word ".repeat(400), 50).endsWith("…")).toBe(true);
  });
});
