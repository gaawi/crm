import { describe, expect, it } from "vitest";
import { automatedReason, detectAutomated, MAX_AUTOMATED_BODY_CHARS, parseGmailMessage } from "@/lib/gmail/parse";
import type { GmailHeader, GmailMessage } from "@/lib/gmail/types";
import { cleanDisplayName, participantRows, selectContactCandidates } from "@/lib/sync/rules";
import { addr, parsed } from "../helpers/sync";

const h = (pairs: Record<string, string>): GmailHeader[] => Object.entries(pairs).map(([name, value]) => ({ name, value }));
const SELF = new Set(["me@example.com", "alias@example.com"]);

describe("automatedReason", () => {
  const base = { labelIds: [] as string[], fromEmail: "jane@example.org", outbound: false };

  it("reports the strongest signal first", () => {
    const all = h({ "List-Id": "<x.list>", Precedence: "bulk", "Auto-Submitted": "auto-generated", "List-Unsubscribe": "<mailto:u@x>" });
    expect(automatedReason({ ...base, headers: all, labelIds: ["CATEGORY_PROMOTIONS"], fromEmail: "noreply@x.com" })).toBe("list_id");
    expect(automatedReason({ ...base, headers: h({ Precedence: "list", "List-Unsubscribe": "<u>" }) })).toBe("precedence");
    expect(automatedReason({ ...base, headers: h({ Precedence: "junk" }) })).toBe("precedence");
    expect(automatedReason({ ...base, headers: h({ Precedence: "first-class" }) })).toBeNull();
    expect(automatedReason({ ...base, headers: h({ "Auto-Submitted": "auto-replied", "List-Unsubscribe": "<u>" }) })).toBe(
      "auto_submitted",
    );
    expect(automatedReason({ ...base, headers: h({ "Auto-Submitted": "no" }) })).toBeNull();
    expect(automatedReason({ ...base, headers: h({ "List-Unsubscribe": "<https://x/u>" }) })).toBe("unsubscribe");
    expect(automatedReason({ ...base, headers: [], labelIds: ["CATEGORY_SOCIAL"] })).toBe("category");
    expect(automatedReason({ ...base, headers: [], labelIds: ["CATEGORY_UPDATES", "CATEGORY_FORUMS"] })).toBeNull();
    expect(automatedReason({ ...base, headers: [], fromEmail: "no-reply@shop.com" })).toBe("noreply");
    expect(automatedReason({ ...base, headers: [] })).toBeNull();
  });

  it("is null for outbound mail and consistent with detectAutomated", () => {
    const params = { ...base, headers: h({ "List-Id": "<x>" }), outbound: true };
    expect(automatedReason(params)).toBeNull();
    expect(detectAutomated(params)).toBe(false);
    expect(detectAutomated({ ...base, headers: h({ "List-Id": "<x>" }) })).toBe(true);
  });

  it("treats contact forms (no-reply sender + real Reply-To, no list headers) as human", () => {
    const form = { ...base, headers: [], fromEmail: "form-noreply@squarespace.info", replyTo: [addr("visitor@gmail.com")] };
    expect(automatedReason({ ...form, fromEmail: "no-reply@squarespace.info" })).toBeNull();
    // Auto-Submitted / categories do not override the contact-form rule.
    expect(automatedReason({ ...form, fromEmail: "noreply@wix.com", headers: h({ "Auto-Submitted": "auto-generated" }) })).toBeNull();
    // Mailing-list headers do.
    expect(automatedReason({ ...form, fromEmail: "noreply@wix.com", headers: h({ "List-Unsubscribe": "<u>" }) })).toBe("unsubscribe");
    expect(automatedReason({ ...form, fromEmail: "noreply@wix.com", headers: h({ Precedence: "bulk" }) })).toBe("precedence");
    // Reply-To that is itself no-reply, or me, is not a real address.
    expect(automatedReason({ ...form, fromEmail: "noreply@wix.com", replyTo: [addr("donotreply@wix.com")] })).toBe("noreply");
    expect(
      automatedReason({ ...form, fromEmail: "noreply@wix.com", replyTo: [addr("me@example.com")], selfEmails: SELF }),
    ).toBe("noreply");
  });

  it("parseGmailMessage stores the reason and caps automated bodies at 500 chars", () => {
    const message = (headers: Record<string, string>, labels: string[] = ["INBOX"]): GmailMessage => ({
      id: "x1",
      threadId: "t1",
      labelIds: labels,
      internalDate: "1767225600000",
      payload: {
        mimeType: "text/plain",
        headers: h({ From: "News <news@brand.com>", To: "me@example.com", Subject: "Hi", ...headers }),
        body: { size: 2000, data: Buffer.from("x".repeat(2000)).toString("base64url") },
      },
    });
    const list = parseGmailMessage(message({ "List-Id": "<brand.list>" }), { selfEmails: SELF });
    expect(list.isAutomated).toBe(true);
    expect(list.automatedReason).toBe("list_id");
    expect(list.bodyText?.length).toBe(MAX_AUTOMATED_BODY_CHARS);
    expect(MAX_AUTOMATED_BODY_CHARS).toBe(500);

    const form = parseGmailMessage(
      message({ From: "Squarespace <no-reply@squarespace.info>", "Reply-To": "Visitor <visitor@gmail.com>" }),
      { selfEmails: SELF },
    );
    expect(form.isAutomated).toBe(false);
    expect(form.automatedReason).toBeNull();
    expect(form.bodyText?.length).toBe(2000);

    const sent = parseGmailMessage(message({ "List-Id": "<x>" }, ["SENT"]), { selfEmails: SELF });
    expect(sent.direction).toBe("outbound");
    expect(sent.automatedReason).toBeNull();
  });
});

describe("selectContactCandidates", () => {
  it("takes every outbound recipient except self, no-reply and invalid ones", () => {
    const message = parsed({
      direction: "outbound",
      from: addr("me@example.com"),
      to: [addr("a@x.org", "A"), addr("alias@example.com")],
      cc: [addr("b@y.org"), addr("noreply@z.com")],
      bcc: [addr("Bad Address@x.org"), addr("a@x.org", "Other name")],
    });
    expect(selectContactCandidates(message, SELF)).toEqual([
      { email: "a@x.org", name: "A" },
      { email: "b@y.org", name: null },
    ]);
  });

  it("skips mass mail with more than 20 recipients", () => {
    const to = Array.from({ length: 21 }, (_, i) => addr(`p${i}@x.org`));
    expect(selectContactCandidates(parsed({ direction: "outbound", from: addr("me@example.com"), to }), SELF)).toEqual([]);
    expect(selectContactCandidates(parsed({ direction: "outbound", from: addr("me@example.com"), to: to.slice(0, 20) }), SELF)).toHaveLength(20);
  });

  it("takes the inbound sender only when the message is not automated", () => {
    expect(selectContactCandidates(parsed({ from: addr("jane@x.org", "Jane") }), SELF)).toEqual([{ email: "jane@x.org", name: "Jane" }]);
    expect(
      selectContactCandidates(parsed({ from: addr("jane@x.org"), isAutomated: true, automatedReason: "unsubscribe" }), SELF),
    ).toEqual([]);
    expect(selectContactCandidates(parsed({ from: addr("me@example.com") }), SELF)).toEqual([]);
  });

  it("takes the Reply-To of contact forms, but not of mailing lists", () => {
    const form = parsed({ from: addr("no-reply@squarespace.info"), replyTo: [addr("visitor@gmail.com", "Visitor")] });
    expect(selectContactCandidates(form, SELF)).toEqual([{ email: "visitor@gmail.com", name: "Visitor" }]);
    const autoForm = { ...form, isAutomated: true, automatedReason: "auto_submitted" };
    expect(selectContactCandidates(autoForm, SELF)).toEqual([{ email: "visitor@gmail.com", name: "Visitor" }]);
    const list = parsed({
      from: addr("notifications@github.com"),
      replyTo: [addr("reply+abc@reply.github.com")],
      isAutomated: true,
      automatedReason: "list_id",
    });
    expect(selectContactCandidates(list, SELF)).toEqual([]);
    const toSelf = parsed({ from: addr("no-reply@forms.com"), replyTo: [addr("alias@example.com")] });
    expect(selectContactCandidates(toSelf, SELF)).toEqual([]);
  });
});

describe("participantRows / cleanDisplayName", () => {
  it("lists every role once, reply_to only when it differs from the sender", () => {
    const rows = participantRows(
      parsed({
        from: addr("jane@x.org", "Jane"),
        to: [addr("me@example.com"), addr("me@example.com")],
        cc: [addr("jane@x.org")],
        replyTo: [addr("jane@x.org"), addr("assistant@x.org", "'Assistant'")],
        bcc: [addr("Not Valid@x.org")],
      }),
    );
    expect(rows).toEqual([
      { role: "from", email: "jane@x.org", name: "Jane" },
      { role: "to", email: "me@example.com", name: null },
      { role: "cc", email: "jane@x.org", name: null },
      { role: "reply_to", email: "assistant@x.org", name: "Assistant" },
    ]);
  });

  it("cleans display names", () => {
    expect(cleanDisplayName('  "Jane  Doe" ', "jane@x.org")).toBe("Jane Doe");
    expect(cleanDisplayName("jane@x.org", "jane@x.org")).toBeNull();
    expect(cleanDisplayName("<JANE@x.org>", "jane@x.org")).toBeNull();
    expect(cleanDisplayName("other@y.org", "jane@x.org")).toBeNull();
    expect(cleanDisplayName("   ", "jane@x.org")).toBeNull();
    expect(cleanDisplayName(null, "jane@x.org")).toBeNull();
    expect(cleanDisplayName("Jane (via Forms)", "jane@x.org")).toBe("Jane (via Forms)");
  });
});

describe("isMachineAddress", () => {
  it("recognizes bulk, transactional and opt-out addresses", async () => {
    const { isMachineAddress } = await import("@/lib/sync/rules");
    for (const email of [
      "1axc3101eri14jd7ca0p3mg3aoapz6qnltjc72-info=creartbox.nyc@bf53x.hubspotemail.net",
      "32.mrtvg2jsm5kueqknj43hsulcin2xg22=@unsubscribe2.customer.io",
      "opt-out-1100.e7kx49c58359n32c7zb9@express.medallia.com",
      "service@paypal.com",
      "account-update@amazon.com",
      "americanexpress@welcome.americanexpress.com",
      "email@email.shopify.com",
      "info@messages.tax.ny.gov",
      "invoice+statements+acct_1cdtvkfbcxij1779@stripe.com",
      "help@surepayroll.com",
      "skip@info.helloskip.com",
    ]) {
      expect(isMachineAddress(email), email).toBe(true);
    }
    for (const email of ["emoe@pitt.edu", "info@creartbox.nyc", "jane.doe@mail.harvard.edu", "booking@lincolncenter.org", "anna@venue.org"]) {
      expect(isMachineAddress(email), email).toBe(false);
    }
  });
});
