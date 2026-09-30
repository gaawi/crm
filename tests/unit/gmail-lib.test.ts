import { describe, expect, it } from "vitest";
import { GmailApiError, GmailClient, parseRetryAfter } from "@/lib/gmail/client";
import { buildRawMessage, encodeHeaderValue, formatAddress, replySubject } from "@/lib/gmail/mime";
import { canCompose, canModify, emailFromIdToken, hasRequiredScopes } from "@/lib/gmail/oauth";
import { decodeMimeWords, extractBodies, htmlToText, parseAddressList, stripQuotedText } from "@/lib/gmail/parse";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const decodeRaw = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

describe("mime", () => {
  it("builds a UTF-8 message with encoded headers and a base64 body", () => {
    const raw = buildRawMessage({
      from: { email: "me@own.test", name: "Élise Martin" },
      to: [{ email: "anna@venue.test", name: "Anna" }],
      cc: [{ email: "bob@venue.test", name: null }],
      bcc: [{ email: "archive@own.test", name: null }],
      subject: "Concierto — fechas",
      bodyText: "Hola Anna,\n¿Qué tal?",
      date: new Date("2026-09-30T12:00:00Z"),
    });
    const text = decodeRaw(raw);
    const [head, body] = text.split("\r\n\r\n");
    expect(head).toContain("From: =?UTF-8?B?");
    expect(head).toContain("<me@own.test>");
    expect(head).toContain("To: Anna <anna@venue.test>");
    expect(head).toContain("Cc: bob@venue.test");
    expect(head).toContain("Bcc: archive@own.test");
    expect(head).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(head).toContain("Date: Wed, 30 Sep 2026 12:00:00 +0000");
    expect(head).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Hola Anna,\r\n¿Qué tal?");
  });

  it("blocks header injection through subjects and names", () => {
    const text = decodeRaw(
      buildRawMessage({
        from: { email: "me@own.test", name: "Me\r\nBcc: evil@x.test" },
        to: [{ email: "anna@venue.test\r\nBcc: evil@x.test", name: null }],
        subject: "Hi\r\nBcc: evil@x.test",
        bodyText: "x",
      }),
    );
    const head = text.split("\r\n\r\n")[0];
    expect(head.split("\r\n").filter((line) => /^bcc:/i.test(line))).toEqual([]);
  });

  it("threads replies with In-Reply-To and References", () => {
    const head = decodeRaw(
      buildRawMessage({
        from: { email: "me@own.test", name: null },
        to: [{ email: "anna@venue.test", name: null }],
        subject: "Re: Dates",
        bodyText: "ok",
        inReplyTo: "<b@venue.test>",
        references: "<a@venue.test>",
      }),
    ).split("\r\n\r\n")[0];
    expect(head).toContain("In-Reply-To: <b@venue.test>");
    expect(head).toContain("References: <a@venue.test> <b@venue.test>");
  });

  it("computes reply subjects", () => {
    expect(replySubject("Dates")).toBe("Re: Dates");
    expect(replySubject("RE: Dates")).toBe("RE: Dates");
    expect(replySubject("Fwd: Dates")).toBe("Re: Dates");
    expect(replySubject(null)).toBe("");
  });

  it("encodes non-ASCII header values and quotes display names", () => {
    expect(encodeHeaderValue("plain")).toBe("plain");
    expect(encodeHeaderValue("café")).toMatch(/^=\?UTF-8\?B\?/);
    expect(formatAddress({ email: "a@b.test", name: "Lee, Anna" })).toBe('"Lee, Anna" <a@b.test>');
  });
});

describe("oauth scopes", () => {
  const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
  it("recognizes what each scope allows", () => {
    expect(hasRequiredScopes([MODIFY])).toBe(true);
    expect(canCompose([MODIFY])).toBe(true);
    expect(canModify([MODIFY])).toBe(true);
    expect(hasRequiredScopes(["https://www.googleapis.com/auth/gmail.readonly"])).toBe(true);
    expect(canModify(["https://www.googleapis.com/auth/gmail.readonly"])).toBe(false);
    expect(hasRequiredScopes(["openid", "email"])).toBe(false);
  });

  it("reads the email claim of an id token", () => {
    const token = `${b64url("{}")}.${b64url(JSON.stringify({ email: "Me@Own.test", email_verified: true }))}.sig`;
    expect(emailFromIdToken(token)?.toLowerCase()).toBe("me@own.test");
    expect(emailFromIdToken("garbage")).toBeNull();
  });
});

describe("GmailClient", () => {
  function client(responses: (() => Response)[], tokens: string[] = []) {
    const calls: { url: string; auth: string | null; method: string }[] = [];
    let i = 0;
    const gmail = new GmailClient({
      getAccessToken: async (force) => {
        tokens.push(force ? "refreshed" : "cached");
        return force ? "t2" : "t1";
      },
      fetch: async (input, init) => {
        calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), method: init?.method ?? "GET" });
        const next = responses[Math.min(i++, responses.length - 1)];
        return next();
      },
      retryBaseMs: 0,
      maxRequestsPerSecond: Infinity,
    });
    return { gmail, calls };
  }
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  it("refreshes the token once on 401", async () => {
    const tokens: string[] = [];
    const { gmail, calls } = client([json(401, { error: { message: "expired" } }), json(200, { emailAddress: "me@own.test", historyId: "1" })], tokens);
    await expect(gmail.getProfile()).resolves.toMatchObject({ emailAddress: "me@own.test" });
    expect(calls.map((c) => c.auth)).toEqual(["Bearer t1", "Bearer t2"]);
    expect(tokens).toEqual(["cached", "refreshed"]);
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const { gmail, calls } = client([
      json(429, { error: { message: "slow down" } }, { "retry-after": "0" }),
      json(403, { error: { message: "quota", errors: [{ reason: "userRateLimitExceeded" }] } }),
      json(503, { error: { message: "unavailable" } }),
      json(200, { id: "m1", threadId: "t1" }),
    ]);
    await expect(gmail.getMessage("m1")).resolves.toMatchObject({ id: "m1" });
    expect(calls).toHaveLength(4);
  });

  it("does not retry permission errors and maps 404 to null", async () => {
    const denied = client([json(403, { error: { message: "no", errors: [{ reason: "insufficientPermissions" }] } })]);
    await expect(denied.gmail.getProfile()).rejects.toMatchObject({ status: 403, reason: "insufficientPermissions" });
    expect(denied.calls).toHaveLength(1);
    const missing = client([json(404, { error: { message: "gone" } })]);
    await expect(missing.gmail.getThread("t1")).resolves.toBeNull();
  });

  it("never retries sending after a network error", async () => {
    const { gmail, calls } = client([
      () => {
        throw new TypeError("socket hang up");
      },
    ]);
    await expect(gmail.sendMessage({ raw: "x" })).rejects.toBeInstanceOf(GmailApiError);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST" });
  });

  it("calls the mail-client endpoints", async () => {
    const { gmail, calls } = client([json(200, { id: "t1", messages: [] })]);
    await gmail.modifyThread("t1", { removeLabelIds: ["INBOX"] });
    await gmail.trashThread("t1");
    await gmail.batchModifyMessages(["a", "b"], { addLabelIds: ["STARRED"] });
    await gmail.batchModifyMessages([], { addLabelIds: ["STARRED"] });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname.replace("/gmail/v1/users/me/", "")}`)).toEqual([
      "POST threads/t1/modify",
      "POST threads/t1/trash",
      "POST messages/batchModify",
    ]);
  });

  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 5_000)).toBe(5000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("parse", () => {
  it("decodes RFC 2047 words and address lists", () => {
    expect(decodeMimeWords("=?UTF-8?B?w4lsaXNl?= =?ISO-8859-1?Q?Mart=EDn?=")).toBe("ÉliseMartín");
    expect(parseAddressList('"Lee, Anna" <Anna@Venue.test>, bob@fund.test, broken')).toEqual([
      { email: "anna@venue.test", name: "Lee, Anna" },
      { email: "bob@fund.test", name: null },
    ]);
  });

  it("extracts text and html bodies from multipart messages, decoding charsets", () => {
    const latin1 = Buffer.from("Caf\xe9 ma\xf1ana", "latin1").toString("base64url");
    const bodies = extractBodies({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=ISO-8859-1" }], body: { size: 12, data: latin1 } },
        { mimeType: "text/html", headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: { size: 20, data: b64url("<p>Café mañana</p>") } },
      ],
    });
    expect(bodies.text).toBe("Café mañana");
    expect(bodies.html).toBe("<p>Café mañana</p>");
  });

  it("converts HTML to readable text", () => {
    const text = htmlToText("<style>p{color:red}</style><p>Hello&nbsp;<b>Anna</b></p><ul><li>One</li><li>Two</li></ul><script>x()</script>");
    expect(text).toContain("Hello Anna");
    expect(text).toMatch(/One[\s\S]*Two/);
    expect(text).not.toMatch(/color:red|x\(\)/);
  });

  it("strips quoted replies but keeps the new text", () => {
    const text = "Sounds good, see you Friday.\n\nOn Tue, Sep 29, 2026 at 10:00 AM Anna <anna@venue.test> wrote:\n> Can we meet?\n> Thanks";
    expect(stripQuotedText(text).trim()).toBe("Sounds good, see you Friday.");
  });
});
