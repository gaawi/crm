import { describe, expect, it } from "vitest";
import {
  composeSubject,
  forwardBlock,
  forwardSubject,
  hasReplyAll,
  outgoingBody,
  parseRecipientInput,
  quoteHeader,
  quoteLines,
  replyQuote,
  replyRecipients,
  type ReplySource,
} from "@/lib/mail/compose";
import { ATTACHMENT_PART_ID, attachmentContentType, contentDisposition } from "@/lib/mail/attachment";
import { firstName, formatBytes, formatListDate, formatMessageDate, sendersText } from "@/lib/mail/format";
import { mailListHref, nextPageHref, pageStart, parseMailParams, prevPageHref, threadHref, listTitle } from "@/lib/mail/params";
import { REVEALED_WIDTH, SWIPE, swipeLock, swipeOffset, swipeRelease } from "@/lib/mail/swipe";

const TZ = "America/New_York";
const own = new Set(["studio@example-studio.com", "me.personal@gmail.com"]);
const maya = { email: "maya@harborarts.org", name: "Maya Chen" };
const tomas = { email: "tomas@harborarts.org", name: "Tomás Ruiz" };
const studio = { email: "studio@example-studio.com", name: "Example Studio" };

function message(overrides: Partial<ReplySource> = {}): ReplySource {
  return {
    from: maya,
    to: [studio],
    cc: [],
    replyTo: [],
    outbound: false,
    date: new Date("2026-09-29T19:04:00Z"),
    subject: "Spring cycle",
    text: "Hi!\n\nThe deadline moved.\n",
    ...overrides,
  };
}

describe("replyRecipients", () => {
  it("replies to the sender of an inbound message", () => {
    expect(replyRecipients(message(), "reply", own)).toEqual({ to: [maya], cc: [] });
  });

  it("prefers Reply-To over From", () => {
    const list = { email: "forms@harborarts.org", name: null };
    expect(replyRecipients(message({ replyTo: [list] }), "reply", own).to).toEqual([list]);
    // Reply all keeps the original sender in Cc.
    expect(replyRecipients(message({ replyTo: [list] }), "reply_all", own)).toEqual({ to: [list], cc: [maya] });
  });

  it("replying to your own message goes to its original To", () => {
    const sent = message({ from: studio, to: [maya, tomas], cc: [{ email: "Me.Personal@gmail.com", name: "Me" }], outbound: true });
    expect(replyRecipients(sent, "reply", own).to).toEqual([maya, tomas]);
    expect(replyRecipients(sent, "reply_all", own).cc).toEqual([]);
  });

  it("reply all puts the other recipients in Cc minus own addresses and duplicates", () => {
    const m = message({ to: [studio, tomas, { email: "MAYA@harborarts.org", name: "Maya" }], cc: [{ email: "me.personal@gmail.com", name: null }, tomas, { email: "press@x.org", name: null }] });
    expect(replyRecipients(m, "reply_all", own)).toEqual({ to: [maya], cc: [tomas, { email: "press@x.org", name: null }] });
    expect(hasReplyAll(m, own)).toBe(true);
    expect(hasReplyAll(message(), own)).toBe(false);
  });

  it("lower-cases addresses", () => {
    expect(replyRecipients(message({ from: { email: "Maya@HarborArts.org", name: "Maya" } }), "reply", own).to).toEqual([
      { email: "maya@harborarts.org", name: "Maya" },
    ]);
  });
});

describe("subjects", () => {
  it("builds reply and forward subjects", () => {
    expect(composeSubject("reply", "Hello")).toBe("Re: Hello");
    expect(composeSubject("reply_all", "RE: Hello")).toBe("RE: Hello");
    expect(composeSubject("forward", "Re: Hello")).toBe("Fwd: Re: Hello");
    expect(forwardSubject("Fwd: Hello")).toBe("Fwd: Hello");
    expect(forwardSubject(null)).toBe("Fwd:");
    expect(composeSubject("new", null)).toBe("");
  });
});

describe("quoting and forwarding", () => {
  it("quotes lines with a Gmail-style header", () => {
    expect(quoteLines("a\n\nb\n\n")).toBe("> a\n>\n> b");
    expect(quoteHeader(message(), TZ)).toBe("On Tue, Sep 29, 2026 at 3:04 PM, Maya Chen <maya@harborarts.org> wrote:");
    expect(replyQuote(message(), TZ)).toBe(
      "On Tue, Sep 29, 2026 at 3:04 PM, Maya Chen <maya@harborarts.org> wrote:\n> Hi!\n>\n> The deadline moved.",
    );
  });

  it("builds the forwarded message block", () => {
    const block = forwardBlock(message({ cc: [tomas] }), TZ);
    expect(block).toBe(
      [
        "---------- Forwarded message ---------",
        "From: Maya Chen <maya@harborarts.org>",
        "Date: Tue, Sep 29, 2026 at 3:04 PM",
        "Subject: Spring cycle",
        "To: Example Studio <studio@example-studio.com>",
        "Cc: Tomás Ruiz <tomas@harborarts.org>",
        "",
        "Hi!\n\nThe deadline moved.",
      ].join("\n"),
    );
  });

  it("appends the quote at send time only when included", () => {
    expect(outgoingBody("Thanks!\n\n", "> x", true)).toBe("Thanks!\n\n> x");
    expect(outgoingBody("Thanks!", "> x", false)).toBe("Thanks!");
    expect(outgoingBody("", "> x", true)).toBe("> x");
    expect(outgoingBody("Hi", null, true)).toBe("Hi");
  });
});

describe("parseRecipientInput", () => {
  it("splits pasted lists and keeps invalid pieces", () => {
    expect(parseRecipientInput('a@x.com, "Chen, Maya" <Maya@Harborarts.org>; nope\nmailto:b@y.io')).toEqual({
      addresses: [
        { email: "a@x.com", name: null },
        { email: "maya@harborarts.org", name: "Chen, Maya" },
        { email: "b@y.io", name: null },
      ],
      rest: "nope",
    });
  });
});

describe("formatListDate", () => {
  const now = new Date("2026-09-30T18:00:00Z"); // 2 PM in New York
  it("formats like Gmail", () => {
    expect(formatListDate(new Date("2026-09-30T13:05:00Z"), TZ, now)).toBe("9:05 AM");
    expect(formatListDate(new Date("2026-09-03T13:05:00Z"), TZ, now)).toBe("Sep 3");
    expect(formatListDate(new Date("2025-03-09T13:05:00Z"), TZ, now)).toBe("3/9/25");
  });

  it("uses the app timezone for the day boundary", () => {
    // 01:30 UTC on Sep 30 is still Sep 29 in New York.
    expect(formatListDate(new Date("2026-09-30T01:30:00Z"), TZ, now)).toBe("Sep 29");
  });

  it("formats like iPhone Mail", () => {
    expect(formatListDate(new Date("2026-09-29T15:00:00Z"), TZ, now, "ios")).toBe("Yesterday");
    expect(formatListDate(new Date("2026-09-26T15:00:00Z"), TZ, now, "ios")).toBe("Saturday");
    expect(formatListDate(new Date("2026-09-03T15:00:00Z"), TZ, now, "ios")).toBe("9/3/26");
  });

  it("formats message headers with a relative time", () => {
    expect(formatMessageDate(new Date("2026-09-29T19:04:00Z"), TZ, now)).toBe("Tue, Sep 29, 3:04 PM (22 hours ago)");
    expect(formatMessageDate(new Date("2025-09-29T19:04:00Z"), TZ, now)).toBe("Mon, Sep 29, 2025, 3:04 PM");
  });
});

describe("senders", () => {
  const s = (name: string | null, email: string, outbound = false, unread = false) => ({ name, email, outbound, unread });
  it("shows one sender in full and several by first name", () => {
    expect(sendersText([s("Maya Chen", "maya@x.org")])).toBe("Maya Chen");
    expect(sendersText([s("Maya Chen", "maya@x.org"), s("Studio", "studio@x.com", true), s("Maya Chen", "maya@x.org")])).toBe("Maya, me (3)");
    expect(
      sendersText([s("Anna A", "a@x"), s("Ben B", "b@x"), s("Cleo C", "c@x"), s(null, "dan@x.org"), s("Studio", "me@x", true)]),
    ).toBe("Anna .. dan, me (5)");
    expect(firstName("Chen, Maya")).toBe("Maya");
  });

  it("formats sizes", () => {
    expect(formatBytes(482_133)).toBe("471 KB");
    expect(formatBytes(2_500_000)).toBe("2.4 MB");
    expect(formatBytes(0)).toBe("");
  });
});

describe("mail params", () => {
  const account = "3f2b8c1e-0000-4000-8000-000000000001";
  it("parses and validates the list state", () => {
    const state = parseMailParams({ view: "starred", account, cursor: "abc_DEF-1", trail: "x1.bad$.y2", q: "  from:maya " });
    expect(state).toEqual({ view: "starred", tab: "primary", account, label: null, q: "from:maya", cursor: "abc_DEF-1", trail: ["x1", "y2"] });
    expect(parseMailParams({ view: "label" }).view).toBe("inbox");
    expect(parseMailParams({ view: "nope", tab: "social", account: "x" })).toMatchObject({ view: "inbox", tab: "social", account: null });
  });

  it("builds list, thread and paging links", () => {
    expect(mailListHref({ view: "inbox", tab: "primary" })).toBe("/mail");
    expect(mailListHref({ view: "inbox", tab: "promotions", account })).toBe(`/mail?tab=promotions&account=${account}`);
    expect(mailListHref({ view: "label", label: "Label_1" })).toBe("/mail?view=label&label=Label_1");
    expect(threadHref(account, "t1", { view: "sent" })).toBe(`/mail/t/${account}/t1?view=sent`);
    const first = parseMailParams({});
    const second = parseMailParams(Object.fromEntries(new URL(nextPageHref(first, "c1"), "http://x").searchParams));
    expect(second).toMatchObject({ cursor: "c1", trail: [] });
    expect(pageStart(second, 50)).toBe(51);
    const third = parseMailParams(Object.fromEntries(new URL(nextPageHref(second, "c2"), "http://x").searchParams));
    expect(third).toMatchObject({ cursor: "c2", trail: ["c1"] });
    expect(pageStart(third, 50)).toBe(101);
    expect(prevPageHref(third)).toBe("/mail?cursor=c1");
    expect(prevPageHref(second)).toBe("/mail");
    expect(prevPageHref(first)).toBeNull();
  });

  it("titles lists like iPhone Mail", () => {
    expect(listTitle(parseMailParams({}))).toBe("All Inboxes");
    expect(listTitle(parseMailParams({ account }))).toBe("Inbox");
    expect(listTitle(parseMailParams({ tab: "social" }))).toBe("Social");
    expect(listTitle(parseMailParams({ view: "all" }))).toBe("All mail");
    expect(listTitle(parseMailParams({ q: "x" }))).toBe("Search");
  });
});

describe("swipe", () => {
  it("locks the direction after the slop", () => {
    expect(swipeLock(3, 2)).toBeNull();
    expect(swipeLock(-20, 4)).toBe("horizontal");
    expect(swipeLock(6, 14)).toBe("vertical");
  });

  it("decides the outcome on release", () => {
    const width = 393;
    expect(swipeRelease(-20, width)).toBe("close");
    expect(swipeRelease(-20, width, -0.8)).toBe("open");
    expect(swipeRelease(-(SWIPE.revealAt + 1), width)).toBe("open");
    expect(swipeRelease(-REVEALED_WIDTH, width)).toBe("open");
    expect(swipeRelease(-width * 0.6, width)).toBe("archive");
    expect(swipeRelease(SWIPE.toggleAt, width)).toBe("toggle-read");
    expect(swipeRelease(30, width)).toBe("close");
  });

  it("resists past the limits", () => {
    expect(swipeOffset(-500, 393)).toBe(-393);
    expect(swipeOffset(SWIPE.maxRight + 40, 393)).toBe(SWIPE.maxRight + 10);
    expect(swipeOffset(50, 393)).toBe(50);
  });
});

describe("attachment headers", () => {
  it("always downloads, with an RFC 5987 filename", () => {
    expect(contentDisposition("floor plan.pdf")).toBe(`attachment; filename="floor plan.pdf"; filename*=UTF-8''floor%20plan.pdf`);
    expect(contentDisposition('Ré"sumé;\r\n.pdf')).toBe(`attachment; filename="R__sum___.pdf"; filename*=UTF-8''R%C3%A9%22sum%C3%A9%3B_.pdf`);
    expect(contentDisposition("../../etc/passwd")).toBe(`attachment; filename=".._.._etc_passwd"; filename*=UTF-8''.._.._etc_passwd`);
    expect(contentDisposition("")).toContain('filename="attachment"');
  });

  it("never serves renderable types", () => {
    expect(attachmentContentType("application/pdf")).toBe("application/pdf");
    expect(attachmentContentType("image/jpeg")).toBe("image/jpeg");
    for (const t of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/plain", "application/javascript", "bogus", "a/b; x=1"]) {
      expect(attachmentContentType(t), t).toBe("application/octet-stream");
    }
    expect(ATTACHMENT_PART_ID.test("1.2")).toBe(true);
    expect(ATTACHMENT_PART_ID.test("1/../2")).toBe(false);
  });
});
