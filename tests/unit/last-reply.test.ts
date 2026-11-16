import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ sql: () => [] }));

const { newPart, unwrap } = await import("@/lib/queries/last-reply");

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

describe("unwrap", () => {
  it("joins hard-wrapped lines and keeps short lines and lists", () => {
    const body =
      "Guillermo,\n\nYour email is timely as our Artist Selection Committee met last night, and\nI can share with you that CreArtBox is on the short list for our *2028-29*\nseason. I have a couple of questions:\n\n1. Are you able to provide these lighting effects when on tour?\n2. What fee do you seek?\n\nThanks,\n\nMark";
    expect(unwrap(body)).toBe(
      "Guillermo,\n\nYour email is timely as our Artist Selection Committee met last night, and I can share with you that CreArtBox is on the short list for our *2028-29* season. I have a couple of questions:\n\n1. Are you able to provide these lighting effects when on tour?\n2. What fee do you seek?\n\nThanks,\n\nMark",
    );
  });
});
