import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { insertAccount, useTestDatabase } from "../setup/db";

// Claude's writing and the Gmail draft are faked; the queue, claims and limits are real.
const fake = vi.hoisted(() => ({ written: [] as { threadId: string; effort?: string }[] }));
vi.mock("@/lib/ai/mail", () => ({
  writeEmailWithClaude: async (params: { threadId: string; effort?: string }) => {
    fake.written.push({ threadId: params.threadId, effort: params.effort });
    return { subject: "Re: Dates", body: "Dear Ana, [confirm fee]" };
  },
}));
vi.mock("@/lib/ai/approvals", async () => {
  const { sql: db } = await import("@/lib/db");
  return {
    proposeEmail: async (input: { accountId: string; subject: string; body: string; origin: string; replyToMessageId: string }) => {
      const [thread] = await db<{ gmailThreadId: string }[]>`select gmail_thread_id from messages where id = ${input.replyToMessageId}`;
      const [row] = await db<{ id: string }[]>`
        insert into email_drafts (account_id, purpose, origin, status, to_emails, subject, body_text, gmail_thread_id, reply_to_message_id)
        values (${input.accountId}, 'reply', ${input.origin}, 'proposed', '{ana@venue.test}', ${input.subject}, ${input.body}, ${thread.gmailThreadId}, ${input.replyToMessageId})
        returning id`;
      return { id: row.id };
    },
  };
});

const { runAutoReplies } = await import("@/lib/ai/auto-reply");

const MODIFY = ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"];

async function important(accountId: string, thread: string, options: { needsReply?: boolean; minutesAgo?: number } = {}) {
  const [m] = await sql<{ id: string }[]>`
    insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, sent_at, label_ids)
    values (${accountId}, ${`${thread}-m`}, ${thread}, 'inbound', 'ana@venue.test', 'Dates?', now() - make_interval(mins => ${options.minutesAgo ?? 30}), '{INBOX,UNREAD}')
    returning id`;
  await sql`
    insert into message_triage (message_id, account_id, important, category, needs_reply, reason, decided_by, decided_at)
    values (${m.id}, ${accountId}, true, 'business', ${options.needsReply ?? true}, 'A presenter asks about dates', 'claude', now())`;
  return m.id;
}

async function replyStatus(messageId: string) {
  const [row] = await sql<{ replyStatus: string | null; replyDraftId: string | null }[]>`
    select reply_status, reply_draft_id from message_triage where message_id = ${messageId}`;
  return row;
}

describe("automatic replies", () => {
  useTestDatabase();
  let account: string;

  beforeEach(async () => {
    process.env.CLAUDE_INBOX = "on";
    fake.written = [];
    account = await insertAccount("me@own.test", { status: "active", scopes: MODIFY });
  });
  afterEach(() => {
    process.env.CLAUDE_INBOX = "off";
  });

  it("drafts a reply with high effort for important emails that need one, once", async () => {
    const asks = await important(account, "t1");
    const fyi = await important(account, "t2", { needsReply: false });

    const result = await runAutoReplies({ deadline: Date.now() + 600_000 });
    expect(result).toMatchObject({ drafted: 1, failed: 0 });
    expect(fake.written).toEqual([{ threadId: "t1", effort: "high" }]);
    const status = await replyStatus(asks);
    expect(status.replyStatus).toBe("drafted");
    const [draft] = await sql<{ origin: string; status: string }[]>`select origin, status from email_drafts where id = ${status.replyDraftId}`;
    expect(draft).toEqual({ origin: "autopilot", status: "proposed" });
    expect((await replyStatus(fyi)).replyStatus).toBeNull();

    expect((await runAutoReplies({ deadline: Date.now() + 600_000 })).drafted).toBe(0);
    expect(fake.written).toHaveLength(1);
  });

  it("leaves conversations alone once someone wrote after the email, and in monitor-only mailboxes", async () => {
    const answered = await important(account, "t1");
    await sql`
      insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, sent_at, label_ids)
      values (${account}, 't1-me', 't1', 'outbound', 'me@own.test', 'Re: Dates?', now(), '{SENT}')`;
    const watched = await insertAccount("partner@own.test", { status: "active", scopes: MODIFY, monitor_only: true });
    const theirs = await important(watched, "t9");

    expect((await runAutoReplies({ deadline: Date.now() + 600_000 })).drafted).toBe(0);
    expect((await replyStatus(answered)).replyStatus).toBeNull();
    expect((await replyStatus(theirs)).replyStatus).toBeNull();
  });

  it("stops at the daily limit and when switched off", async () => {
    await sql`insert into app_settings (key, value) values ('inbox', ${sql.json({ autoReplies: true, autoRepliesPerDay: 2 })})`;
    for (const t of ["t1", "t2", "t3"]) await important(account, t);
    expect((await runAutoReplies({ deadline: Date.now() + 600_000 })).drafted).toBe(2);
    expect((await runAutoReplies({ deadline: Date.now() + 600_000 })).drafted).toBe(0);

    await sql`update app_settings set value = ${sql.json({ autoReplies: false, autoRepliesPerDay: 40 })} where key = 'inbox'`;
    expect((await runAutoReplies({ deadline: Date.now() + 600_000 })).drafted).toBe(0);
    expect(fake.written).toHaveLength(2);
  });
});
