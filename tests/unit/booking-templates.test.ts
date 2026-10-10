import { describe, expect, it } from "vitest";
import { normalizeFee } from "@/lib/booking/fee";
import {
  firstName,
  formatFee,
  isTemplateRationale,
  nextActionTriggers,
  renderTemplate,
  rowTemplateVars,
  suggestTemplate,
  suggestedTriggers,
  templateRationale,
  unknownPlaceholders,
  type SuggestRow,
  type TemplateLike,
} from "@/lib/booking/templates";

describe("firstName", () => {
  it.each([
    ["Ana López", "Ana"],
    ["Sra. María José García", "María"],
    ["Dña. Elena Fernández", "Elena"],
    ["D. Juan Pérez", "Juan"],
    ["Dr. Smith", "Smith"],
    ["ANA LÓPEZ", "Ana"],
    ["Paco / Lucía", "Paco"],
    ["  ", ""],
    [null, ""],
    ["ana@venue.es", ""],
  ])("%s → %s", (name, expected) => {
    expect(firstName(name)).toBe(expected);
  });
});

describe("renderTemplate", () => {
  it("fills known placeholders, empties missing ones, keeps unknown ones", () => {
    const text = "Hola {{first_name}}, {{ venue }} ({{city}}) · {{spaces}} · {{nombre}} · {{fee}}";
    expect(renderTemplate(text, { contact_name: "Sra. Ana López", venue: "Teatro Campoamor", city: null, fee: "4500 €" })).toBe(
      "Hola Ana, Teatro Campoamor () ·  · {{nombre}} · 4500 €",
    );
    expect(renderTemplate("{{FIRST_NAME}}", { first_name: "Eva" })).toBe("Eva");
    expect(unknownPlaceholders("{{first_name}} {{nombre}} {{ municipio }}")).toEqual(["nombre", "municipio"]);
  });

  it("builds a row's values", () => {
    const vars = rowTemplateVars(
      {
        title: "Teatro",
        value: "4500.00",
        currency: "EUR",
        eventDates: "Spring 2027",
        spaces: "Sala principal",
        organization: { name: "Teatro Campoamor", city: "Oviedo" },
        contact: { name: "Ana López" },
      },
      { name: "Gira España 2027" },
      { name: "Guillermo", signature: "Guillermo Laporta" },
    );
    expect(vars).toMatchObject({
      first_name: "Ana",
      contact_name: "Ana López",
      venue: "Teatro Campoamor",
      city: "Oviedo",
      spaces: "Sala principal",
      dates: "Spring 2027",
      sheet: "Gira España 2027",
      my_name: "Guillermo",
      signature: "Guillermo Laporta",
    });
    expect(vars.fee).toMatch(/^4500\s€$/);
  });

  it("formats and reads fees", () => {
    expect(formatFee("2500.00", "USD")).toBe("$2,500");
    expect(formatFee("2500.50", "USD")).toBe("$2,500.50");
    expect(formatFee(null, "USD")).toBe("");
    expect(normalizeFee("4.500")).toBe("4500");
    expect(normalizeFee("4.500,50 €")).toBe("4500.50");
    expect(normalizeFee("$4,500.50")).toBe("4500.50");
    expect(normalizeFee("1200,5")).toBe("1200.5");
    expect(normalizeFee("1.25")).toBe("1.25");
    expect(normalizeFee("3000 EUR")).toBe("3000");
    expect(normalizeFee("a convenir")).toBeNull();
    expect(normalizeFee("")).toBeNull();
  });
});

describe("suggestTemplate", () => {
  const sheet = "11111111-1111-1111-1111-111111111111";
  const t = (id: string, trigger: TemplateLike["trigger"], projectId: string | null = sheet, sortOrder = 0): TemplateLike => ({
    id,
    projectId,
    name: id,
    trigger,
    sortOrder,
  });
  const templates = [
    t("global-first", "first_contact", null),
    t("first", "first_contact", sheet, 2),
    t("first-b", "first_contact", sheet, 1),
    t("follow", "follow_up"),
    t("after", "after_call"),
    t("next", "next_steps"),
    t("ok", "confirmed"),
    t("thanks", "declined"),
    t("manual", "custom"),
  ];
  const row = (patch: Partial<SuggestRow> = {}): SuggestRow => ({ stage: "lead", returning: false, lastCall: null, contact: null, ...patch });

  it("picks by status, the sheet's own first, then sort order", () => {
    expect(suggestTemplate(row(), templates)?.id).toBe("first-b");
    expect(suggestTemplate(row(), [t("global-first", "first_contact", null)])?.id).toBe("global-first");
    expect(suggestTemplate(row({ stage: "negotiation" }), templates)?.id).toBe("next");
    expect(suggestTemplate(row({ stage: "won" }), templates)?.id).toBe("ok");
    expect(suggestTemplate(row({ stage: "lost" }), templates)?.id).toBe("thanks");
    expect(suggestTemplate(row({ stage: "lost" }), [t("manual", "custom")])).toBeNull();
  });

  it("uses the returning template for venues we worked with, else first contact", () => {
    expect(suggestedTriggers(row({ returning: true }))).toEqual(["returning", "first_contact"]);
    expect(suggestTemplate(row({ returning: true }), templates)?.id).toBe("first-b");
    expect(suggestTemplate(row({ returning: true }), [...templates, t("again", "returning")])?.id).toBe("again");
  });

  it("follows up after a call only when you talked since your last email", () => {
    const contact = { lastOutboundAt: "2026-09-20T10:00:00.000Z" };
    expect(suggestTemplate(row({ stage: "contacted", contact }), templates)?.id).toBe("follow");
    const talked = row({ stage: "proposal", contact, lastCall: { outcome: "reached", occurredAt: "2026-09-25T10:00:00.000Z" } });
    expect(suggestTemplate(talked, templates)?.id).toBe("after");
    const callBack = row({ stage: "contacted", contact, lastCall: { outcome: "call_back", occurredAt: new Date("2026-09-25T10:00:00Z") } });
    expect(suggestTemplate(callBack, templates)?.id).toBe("after");
    const noAnswer = row({ stage: "contacted", contact, lastCall: { outcome: "no_answer", occurredAt: "2026-09-25T10:00:00.000Z" } });
    expect(suggestTemplate(noAnswer, templates)?.id).toBe("follow");
    const before = row({ stage: "contacted", contact, lastCall: { outcome: "reached", occurredAt: "2026-09-19T10:00:00.000Z" } });
    expect(suggestTemplate(before, templates)?.id).toBe("follow");
    // No after-call template: the follow-up.
    expect(suggestTemplate(talked, templates.filter((x) => x.trigger !== "after_call"))?.id).toBe("follow");
  });
});

describe("suggestTemplate by next step", () => {
  const t = (id: string, trigger: TemplateLike["trigger"]): TemplateLike => ({ id, projectId: null, name: id, trigger, sortOrder: 0 });
  const templates = [
    t("first", "first_contact"),
    t("again", "returning"),
    t("follow", "follow_up"),
    t("next", "next_steps"),
    t("ok", "confirmed"),
    t("news", "keep_informed"),
    t("thanks", "thanks"),
  ];
  const row = (patch: Partial<SuggestRow> = {}): SuggestRow => ({ stage: "negotiation", returning: false, lastCall: null, contact: null, ...patch });

  it("maps next actions to template situations", () => {
    expect(nextActionTriggers("send_proposal")).toEqual(["first_contact"]);
    expect(nextActionTriggers("send_proposal", true)).toEqual(["returning", "first_contact"]);
    expect(nextActionTriggers("follow_up")).toEqual(["follow_up"]);
    expect(nextActionTriggers("wait_reply")).toEqual(["follow_up"]);
    expect(nextActionTriggers("keep_informed")).toEqual(["keep_informed"]);
    expect(nextActionTriggers("thank_report")).toEqual(["thanks"]);
    for (const a of ["agree_terms", "send_contract", "close_contract"] as const) expect(nextActionTriggers(a)).toEqual(["next_steps"]);
    expect(nextActionTriggers("logistics")).toEqual(["confirmed"]);
    expect(nextActionTriggers("call")).toEqual([]);
    expect(nextActionTriggers(null)).toEqual([]);
  });

  it("uses the next step's template when one exists, else the status", () => {
    expect(suggestTemplate(row({ nextAction: "keep_informed" }), templates)?.id).toBe("news");
    expect(suggestTemplate(row({ stage: "won", nextAction: "thank_report" }), templates)?.id).toBe("thanks");
    expect(suggestTemplate(row({ nextAction: "send_proposal", returning: true }), templates)?.id).toBe("again");
    expect(suggestTemplate(row({ stage: "lead", nextAction: "wait_reply" }), templates)?.id).toBe("follow");
    expect(suggestTemplate(row({ stage: "proposal", nextAction: "logistics" }), templates)?.id).toBe("ok");
    // No template for the action, or an action without one: the status decides.
    expect(suggestTemplate(row({ nextAction: "keep_informed" }), templates.filter((x) => x.trigger !== "keep_informed"))?.id).toBe("next");
    expect(suggestTemplate(row({ nextAction: "call" }), templates)?.id).toBe("next");
    expect(suggestedTriggers(row({ stage: "lead", nextAction: "send_proposal" }))).toEqual(["first_contact"]);
  });
});

describe("templateRationale", () => {
  it("names the campaign and template, and Approvals can tell it apart", () => {
    const r = templateRationale("Festival ADAR", "Propuesta");
    expect(r).toBe('Campaign "Festival ADAR" · template "Propuesta"');
    expect(isTemplateRationale(r)).toBe(true);
    // Emails prepared before the rename.
    expect(isTemplateRationale('Booking sheet "Festival ADAR" · template "Propuesta"')).toBe(true);
    expect(isTemplateRationale("Reply to the latest message in this conversation.")).toBe(false);
    expect(isTemplateRationale(null)).toBe(false);
  });
});
