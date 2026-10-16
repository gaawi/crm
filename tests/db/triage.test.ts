import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { insertAccount, useTestDatabase } from "../setup/db";

// A fake Claude: answers each classification from the subject line.
const claude = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/ai/client", () => ({
  FALLBACK_BETA: "test",
  model: () => "claude-opus-5-5",
  anthropic: () => ({
    beta: {
      messages: {
        parse: async (request: { messages: { content: string }[] }) => {
          claude.calls++;
          const text = request.messages[0].content;
          const pitch = text.includes("SEO services");
          return {
            stop_reason: "end_turn",
            parsed_output: pitch
              ? { important: false, category: "other", needs_reply: false, reason: "Cold sales pitch" }
              : { important: true, category: "business", needs_reply: text.includes("?"), reason: "A presenter asks about dates" },
          };
        },
      },
    },
  }),
}));

const { isOfficialSender, ruleDecision, runTriage, setThreadImportance } = await import("@/lib/mail/triage");
const { getMailCounts, listThreads } = await import("@/lib/mail/queries");

const MODIFY = ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"];
let seq = 0;

async function receive(
  accountId: string,
  from: string,
  subject: string,
  options: { labels?: string[]; automated?: string | null; body?: string; thread?: string } = {},
): Promise<string> {
  seq++;
  const id = `g${seq}`;
  const [row] = await sql<{ id: string }[]>`
    insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, body_text, sent_at, label_ids, is_automated, automated_reason)
    values (${accountId}, ${id}, ${options.thread ?? `t${seq}`}, 'inbound', ${from}, ${subject}, ${options.body ?? subject},
            now() - make_interval(mins => ${100 - seq}), ${["INBOX", "UNREAD", ...(options.labels ?? [])]},
            ${Boolean(options.automated)}, ${options.automated ?? null})
    returning id`;
  return row.id;
}

async function decision(messageId: string) {
  const [row] = await sql<{ important: boolean; category: string; needsReply: boolean; decidedBy: string }[]>`
    select important, category, needs_reply, decided_by from message_triage where message_id = ${messageId}`;
  return row;
}

const subjects = async (category: "primary" | "other") => (await listThreads({ view: "inbox", category })).threads.map((t) => t.subject).sort();

describe("official senders", () => {
  it("recognizes public administrations by domain", () => {
    expect(isOfficialSender("notificaciones@correo.agenciatributaria.gob.es")).toBe(true);
    expect(isOfficialSender("no-reply@seg-social.es")).toBe(true);
    expect(isOfficialSender("cultura@asturias.es")).toBe(true);
    expect(isOfficialSender("alerts@uscis.gov")).toBe(true);
    expect(isOfficialSender("info@ayuntamientodegijon.es")).toBe(true);
    expect(isOfficialSender("hello@government-grants-newsletter.com")).toBe(false);
    expect(isOfficialSender("news@mailchimp.com")).toBe(false);
  });

  it("keeps an official notification important even in Gmail's Updates tab", () => {
    const d = ruleDecision({
      messageId: "x",
      accountId: "a",
      monitorOnly: false,
      fromEmail: "notificaciones@dehu.redsara.gob.es",
      fromName: null,
      subject: "Nueva notificación",
      snippet: null,
      body: null,
      labelIds: ["INBOX", "CATEGORY_UPDATES"],
      isAutomated: true,
      automatedReason: "noreply",
      senderRule: null,
      contact: null,
      campaigns: [],
      ownerWroteToSender: false,
      ownerInThread: false,
    });
    expect(d.final).toMatchObject({ important: true, category: "official", needsReply: false });
  });
});

describe("runTriage", () => {
  useTestDatabase();
  let account: string;

  beforeEach(async () => {
    process.env.CLAUDE_INBOX = "on";
    claude.calls = 0;
    account = await insertAccount("me@own.test", { status: "active", scopes: MODIFY });
  });
  afterEach(() => {
    process.env.CLAUDE_INBOX = "off";
  });

  it("files promotions and newsletters in Other, keeps people and official mail in Important", async () => {
    const promo = await receive(account, "deals@shop.test", "50% off", { labels: ["CATEGORY_PROMOTIONS"], automated: "category" });
    const letter = await receive(account, "news@series.test", "Our season", { automated: "list_id" });
    const official = await receive(account, "avisos@sede.agenciatributaria.gob.es", "Notificación", { labels: ["CATEGORY_UPDATES"], automated: "noreply" });
    const person = await receive(account, "ana@venue.test", "Dates for March?");
    const pitch = await receive(account, "growth@agency.test", "SEO services for your site");

    const result = await runTriage({ deadline: Date.now() + 60_000 });
    expect(result.classified).toBe(5);
    // Only the two written by people needed Claude.
    expect(claude.calls).toBe(2);
    expect(await decision(promo)).toMatchObject({ important: false, decidedBy: "rule" });
    expect(await decision(letter)).toMatchObject({ important: false, category: "newsletter" });
    expect(await decision(official)).toMatchObject({ important: true, category: "official" });
    expect(await decision(person)).toMatchObject({ important: true, needsReply: true, decidedBy: "claude" });
    expect(await decision(pitch)).toMatchObject({ important: false, needsReply: false });

    expect(await subjects("primary")).toEqual(["Dates for March?", "Notificación"]);
    expect(await subjects("other")).toEqual(["50% off", "Our season", "SEO services for your site"]);
    const counts = await getMailCounts();
    expect(counts.inbox).toMatchObject({ primary: 2, other: 3 });

    // Nothing left: a second run classifies nothing and asks Claude nothing.
    expect((await runTriage({ deadline: Date.now() + 60_000 })).classified).toBe(0);
    expect(claude.calls).toBe(2);
  });

  it("uses only the rules for monitor-only mailboxes and when Claude is off", async () => {
    const watched = await insertAccount("partner@own.test", { status: "active", scopes: MODIFY, monitor_only: true });
    const a = await receive(watched, "ana@venue.test", "Dates?");
    process.env.CLAUDE_INBOX = "off";
    const b = await receive(account, "growth@agency.test", "SEO services for your site");
    await runTriage({ deadline: Date.now() + 60_000 });
    expect(claude.calls).toBe(0);
    expect(await decision(a)).toMatchObject({ important: true, needsReply: false, decidedBy: "rule" });
    // Without Claude the rules' guess is provisional…
    expect(await decision(b)).toMatchObject({ important: true, decidedBy: "fallback" });

    // …and Claude reviews it once it is on (the monitor-only mailbox keeps its rules).
    process.env.CLAUDE_INBOX = "on";
    await sql`update message_triage set claimed_at = now() - interval '1 hour'`;
    await runTriage({ deadline: Date.now() + 60_000 });
    expect(claude.calls).toBe(1);
    expect(await decision(b)).toMatchObject({ important: false, decidedBy: "claude" });
    expect(await decision(a)).toMatchObject({ decidedBy: "rule" });
  });

  it("sends obvious machine senders to Other and keeps money and official notices without Claude", async () => {
    process.env.CLAUDE_INBOX = "off";
    const usps = await receive(account, "uspsinformeddelivery@email.informeddelivery.usps.com", "Your Daily Digest");
    const failed = await receive(account, "noreply@bank.test", "Action required: your mobile check deposit failed", { automated: "noreply" });
    const notice = await receive(account, "avisos@notifica.example.com", "Nueva notificación electrónica", { automated: "noreply" });
    const receipt = await receive(account, "noreply@bank.test", "Your check deposit has uploaded successfully", { automated: "noreply" });
    await runTriage({ deadline: Date.now() + 60_000 });
    expect(await decision(usps)).toMatchObject({ important: false, category: "notification" });
    expect(await decision(failed)).toMatchObject({ important: true, category: "finance" });
    expect(await decision(notice)).toMatchObject({ important: true, category: "official" });
    expect(await decision(receipt)).toMatchObject({ important: false });
  });

  it("follows the owner's correction for the conversation and the sender's next emails", async () => {
    const first = await receive(account, "growth@agency.test", "SEO services for your site", { thread: "pitch" });
    await runTriage({ deadline: Date.now() + 60_000 });
    expect(await subjects("other")).toEqual(["SEO services for your site"]);

    await setThreadImportance(account, "pitch", true);
    expect(await decision(first)).toMatchObject({ important: true, decidedBy: "owner" });
    expect(await subjects("primary")).toEqual(["SEO services for your site"]);

    const next = await receive(account, "growth@agency.test", "SEO services, part two");
    claude.calls = 0;
    await runTriage({ deadline: Date.now() + 60_000 });
    expect(claude.calls).toBe(0);
    expect(await decision(next)).toMatchObject({ important: true, decidedBy: "rule" });
  });
});
