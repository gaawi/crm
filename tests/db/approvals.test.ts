import { beforeEach, describe, expect, it, vi } from "vitest";

/* Gmail draft side effects, scriptable per test. */
const state = vi.hoisted(() => ({
  drafts: new Map<string, { to: string[]; subject: string; body: string }>(),
  sent: [] as { to: string[]; body: string }[],
  next: 0,
  failUpdate: null as Error | null,
  failSend: null as Error | null,
  consumeOnFailedSend: false,
}));

vi.mock("@/lib/sync/drafts", async () => {
  const { GmailApiError } = await import("@/lib/gmail/client");
  class DraftError extends Error {}
  return {
    DraftError,
    saveGmailDraft: vi.fn(async (p: { to: string[]; subject: string; body: string }) => {
      const id = `d${++state.next}`;
      state.drafts.set(id, { to: p.to, subject: p.subject, body: p.body });
      return { draftId: id, gmailUrl: "https://mail.google.com/" };
    }),
    updateGmailDraft: vi.fn(async (p: { draftId: string; to: string[]; subject: string; body: string }) => {
      if (state.failUpdate) throw state.failUpdate;
      if (!state.drafts.has(p.draftId)) throw new GmailApiError(404, "Requested entity was not found.");
      state.drafts.set(p.draftId, { to: p.to, subject: p.subject, body: p.body });
      return { draftId: p.draftId, gmailUrl: "https://mail.google.com/" };
    }),
    sendGmailDraft: vi.fn(async (_accountId: string, draftId: string) => {
      const d = state.drafts.get(draftId);
      if (!d) throw new GmailApiError(404, "Requested entity was not found.");
      if (state.failSend) {
        if (state.consumeOnFailedSend) {
          state.drafts.delete(draftId);
          state.sent.push({ to: d.to, body: d.body });
        }
        throw state.failSend;
      }
      state.drafts.delete(draftId);
      state.sent.push({ to: d.to, body: d.body });
      return { gmailMessageId: `sent-${draftId}`, gmailThreadId: "t1" };
    }),
    deleteGmailDraft: vi.fn(async (_a: string, id: string) => void state.drafts.delete(id)),
  };
});

vi.mock("@/lib/sync/accounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sync/accounts")>();
  return {
    ...actual,
    gmailClientFor: () => ({ getDraft: async (id: string) => (state.drafts.has(id) ? { id, message: {} } : null) }),
  };
});

import { sql } from "@/lib/db";
import { GmailApiError } from "@/lib/gmail/client";
import { approveAndSend, proposeEmail, saveDraftEdits } from "@/lib/ai/approvals";
import { createContact } from "@/lib/queries/contacts";
import { getDraft, recoverStaleDrafts } from "@/lib/queries/drafts";
import { insertAccount, useTestDatabase } from "../setup/db";

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("approve & send", () => {
  useTestDatabase();
  let accountId: string;
  let contactId: string;

  beforeEach(async () => {
    state.drafts.clear();
    state.sent.length = 0;
    state.next = 0;
    state.failUpdate = null;
    state.failSend = null;
    state.consumeOnFailedSend = false;
    accountId = await insertAccount("me@own.test", { status: "active" });
    contactId = await createContact({ name: "Maya", emails: ["maya@venue.test", "maya@home.test"] });
  });

  async function propose(body = "Our fee is $5,000.") {
    const draft = await proposeEmail({ accountId, contactId, to: ["maya@venue.test"], subject: "Fee", body, origin: "owner" });
    return draft!.id;
  }

  it("sends exactly the approved version", async () => {
    const id = await propose();
    await saveDraftEdits(id, { subject: "Fee", body: "Our fee is $3,000.", to: ["maya@home.test"], cc: [] });
    await approveAndSend(id);
    expect(state.sent).toEqual([{ to: ["maya@home.test"], body: "Our fee is $3,000." }]);
    expect((await getDraft(id))!.status).toBe("sent");
  });

  it("never sends the old Gmail draft when the update fails", async () => {
    const id = await propose();
    state.failUpdate = new GmailApiError(503, "Backend Error");
    await saveDraftEdits(id, { subject: "Fee", body: "Our fee is $3,000.", to: ["maya@home.test"], cc: [] });
    await expect(approveAndSend(id)).rejects.toThrow(/latest version/);
    expect(state.sent).toEqual([]);
    const row = (await getDraft(id))!;
    expect(row.status).toBe("failed");
    expect([...state.drafts.keys()]).toEqual(["d1"]); // no second draft created
  });

  it("does not silently re-create and send a draft that vanished from Gmail", async () => {
    const id = await propose();
    state.drafts.clear(); // sent or deleted in Gmail
    await expect(approveAndSend(id)).rejects.toThrow(/sent or deleted in Gmail/);
    expect(state.sent).toEqual([]);
    expect((await getDraft(id))!.status).toBe("failed");
    // A second, explicit approval sends a fresh copy.
    await approveAndSend(id);
    expect(state.sent).toHaveLength(1);
  });

  it("marks the email sent when Gmail errors after sending", async () => {
    const id = await propose();
    state.failSend = new GmailApiError(500, "Internal error");
    state.consumeOnFailedSend = true;
    const row = await approveAndSend(id);
    expect(row.status).toBe("sent");
    expect(row.error).toMatch(/Check your Sent folder/);
    expect(state.sent).toHaveLength(1);
    await expect(approveAndSend(id)).rejects.toThrow(/already sent/);
    expect(state.sent).toHaveLength(1);
  });

  it("keeps a real failure retryable", async () => {
    const id = await propose();
    state.failSend = new GmailApiError(500, "Internal error"); // draft not consumed: not sent
    await expect(approveAndSend(id)).rejects.toThrow();
    expect((await getDraft(id))!.status).toBe("failed");
    state.failSend = null;
    await approveAndSend(id);
    expect(state.sent).toHaveLength(1);
  });

  it("releases drafts stuck by an interrupted request", async () => {
    const id = await propose();
    const other = await propose("Second");
    await sql`update email_drafts set status = 'sending' where id = ${id}`;
    await sql`update email_drafts set status = 'revising' where id = ${other}`;
    await recoverStaleDrafts();
    expect((await getDraft(id))!.status).toBe("sending"); // too recent
    await sql`alter table email_drafts disable trigger user`;
    await sql`update email_drafts set updated_at = now() - interval '11 minutes'`;
    await sql`alter table email_drafts enable trigger user`;
    await recoverStaleDrafts();
    expect((await getDraft(id))!).toMatchObject({ status: "failed" });
    expect((await getDraft(other))!).toMatchObject({ status: "proposed" });
  });
});
