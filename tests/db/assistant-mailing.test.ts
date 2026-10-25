import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Gmail drafts are recorded, never sent. */
const state = vi.hoisted(() => ({ drafts: new Map<string, { to: string[]; subject: string; body: string }>(), next: 0 }));

vi.mock("@/lib/sync/drafts", async () => {
  class DraftError extends Error {}
  return {
    DraftError,
    saveGmailDraft: vi.fn(async (p: { to: string[]; subject: string; body: string }) => {
      const id = `d${++state.next}`;
      state.drafts.set(id, { to: p.to, subject: p.subject, body: p.body });
      return { draftId: id, gmailUrl: "https://mail.google.com/" };
    }),
    updateGmailDraft: vi.fn(),
    sendGmailDraft: vi.fn(async () => {
      throw new Error("never sent here");
    }),
    deleteGmailDraft: vi.fn(async (_a: string, id: string) => void state.drafts.delete(id)),
  };
});

import { sql } from "@/lib/db";
import { POST as mailingRoute } from "@/app/api/assistant-agent/mailing/route";
import { addSheetRow, createSheet } from "@/lib/queries/booking";
import { insertAccount, useTestDatabase } from "../setup/db";

describe("assistant mailing API", () => {
  useTestDatabase();
  const TOKEN = "test-assistant-token-0123456789";

  const post = (body: unknown) =>
    mailingRoute(
      new Request("http://localhost:3000/api/assistant-agent/mailing", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
      }),
    );

  beforeEach(() => {
    process.env.ASSISTANT_API_TOKEN = TOKEN;
    state.drafts.clear();
  });
  afterEach(() => {
    delete process.env.ASSISTANT_API_TOKEN;
  });

  async function seed() {
    const accountId = await insertAccount("info@example.com", { status: "active" });
    const projectId = await createSheet({ name: "Community Partners" });
    await sql`update projects set send_account_id = ${accountId} where id = ${projectId}`;
    const ids = [
      await addSheetRow({ projectId, organization: "Music School", email: "office@school.org", kind: "partnership" }),
      await addSheetRow({ projectId, organization: "Museum", email: "members@museum.org", kind: "partnership" }),
      await addSheetRow({ projectId, organization: "No Email Club", kind: "partnership" }),
    ];
    return { projectId, ids, accountId };
  }

  const email = (opportunityId: string, n: number) => ({
    opportunityId,
    subject: `Community tickets ${n}`,
    body: `Hello ${n} — a note.\n\nCreArtBox`,
    reason: "Verified on their contact page.",
  });

  it("prepares one mailing waiting for approval, adds to it, and never sends", async () => {
    const { projectId, ids, accountId } = await seed();
    const first = await (
      await post({ projectId, name: "Community Partners · Currents", settings: { timezone: "America/New_York", perHour: 20 }, emails: [email(ids[0], 0), email(ids[2], 2)] })
    ).json();
    expect(first.created).toHaveLength(1);
    expect(first.skipped).toEqual([{ opportunityId: ids[2], reason: "The row has no contact with an email address." }]);

    const [mailing] = await sql<{ status: string; timezone: string; perHour: number; accountId: string }[]>`
      select status, timezone, per_hour, account_id from email_campaigns where id = ${first.mailingId}`;
    expect(mailing).toEqual({ status: "draft", timezone: "America/New_York", perHour: 20, accountId });

    const second = await (await post({ projectId, mailingId: first.mailingId, emails: [email(ids[1], 1), email(ids[0], 0)] })).json();
    expect(second.created).toHaveLength(1);
    expect(second.skipped[0].reason).toMatch(/already has an email waiting/);

    const drafts = await sql<{ to: string[]; status: string; body: string; origin: string; campaignId: string }[]>`
      select to_emails as to, status, body_text as body, origin, campaign_id from email_drafts order by created_at`;
    expect(drafts.map((d) => [d.to, d.status, d.campaignId])).toEqual([
      [["office@school.org"], "proposed", first.mailingId],
      [["members@museum.org"], "proposed", first.mailingId],
    ]);
    expect(drafts[0].body).not.toContain("—");
  });

  it("refuses a mailing that already started and a campaign without a send account", async () => {
    const { projectId, ids } = await seed();
    const { mailingId } = await (await post({ projectId, name: "M", emails: [email(ids[0], 0)] })).json();
    await sql`update email_campaigns set status = 'running' where id = ${mailingId}`;
    expect((await post({ projectId, mailingId, emails: [email(ids[1], 1)] })).status).toBe(409);
    await sql`update projects set send_account_id = null where id = ${projectId}`;
    expect((await post({ projectId, name: "N", emails: [email(ids[1], 1)] })).status).toBe(409);
    expect((await post({ projectId, emails: [email(ids[1], 1)] })).status).toBe(400);
  });
});
