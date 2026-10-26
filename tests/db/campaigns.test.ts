import { beforeEach, describe, expect, it, vi } from "vitest";

/* Gmail draft side effects, scriptable per test (as in approvals.test.ts): nothing leaves the test. */
const state = vi.hoisted(() => ({
  drafts: new Map<string, { to: string[]; subject: string; body: string }>(),
  sent: [] as { draftId: string; to: string[]; body: string }[],
  next: 0,
  failSend: null as Error | null,
  beforeSend: null as null | (() => Promise<void>),
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
      if (!state.drafts.has(p.draftId)) throw new GmailApiError(404, "Requested entity was not found.");
      state.drafts.set(p.draftId, { to: p.to, subject: p.subject, body: p.body });
      return { draftId: p.draftId, gmailUrl: "https://mail.google.com/" };
    }),
    sendGmailDraft: vi.fn(async (_accountId: string, draftId: string) => {
      await state.beforeSend?.();
      const d = state.drafts.get(draftId);
      if (!d) throw new GmailApiError(404, "Requested entity was not found.");
      if (state.failSend) throw state.failSend;
      state.drafts.delete(draftId);
      state.sent.push({ draftId, to: d.to, body: d.body });
      return { gmailMessageId: `sent-${draftId}`, gmailThreadId: `t-${draftId}` };
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
import { approveAndSend, discardDraft, DraftUnavailableError, proposeEmail, saveDraftEdits } from "@/lib/ai/approvals";
import {
  cancelCampaign,
  createCampaign,
  discardCampaign,
  getCampaign,
  getCampaignSummary,
  listCampaigns,
  pauseCampaign,
  requeueHeldDraft,
  resumeCampaign,
  startCampaign,
  updateCampaignSettings,
} from "@/lib/campaigns/campaigns";
import { runCampaigns } from "@/lib/campaigns/scheduler";
import { ACCOUNT_DAILY_SEND_CAP, type CampaignSettings } from "@/lib/campaigns/types";
import { addActivity } from "@/lib/queries/activities";
import { createContact } from "@/lib/queries/contacts";
import { countPendingDrafts, getDraft, listDrafts } from "@/lib/queries/drafts";
import { insertAccount, useTestDatabase } from "../setup/db";

const MODIFY = ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"];

/** Monday 2026-10-05, 10:00 in Madrid. */
const MON_10 = new Date("2026-10-05T08:00:00Z");
const minutes = (date: Date, n: number) => new Date(date.getTime() + n * 60_000);

/** One cron run at `now`; waits inside the run return at once (the scheduler's clock jumps ahead). */
const run = (now: Date) => runCampaigns({ now, deadline: Date.now() + 600_000, sleep: async () => {} });

async function statuses(campaignId: string): Promise<string[]> {
  const rows = await sql<{ status: string }[]>`select status from email_drafts where campaign_id = ${campaignId} order by created_at, id`;
  return rows.map((r) => r.status);
}

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("gradual campaigns", () => {
  useTestDatabase();
  let accountId: string;
  let seq = 0;

  beforeEach(async () => {
    seq = 0;
    state.drafts.clear();
    state.sent.length = 0;
    state.next = 0;
    state.failSend = null;
    state.beforeSend = null;
    accountId = await insertAccount("me@own.test", { status: "active", scopes: MODIFY });
  });

  /** n contacts, one prepared email each, in a campaign (status draft). */
  async function campaignOf(n: number, settings: Partial<CampaignSettings> = {}) {
    const draftIds: string[] = [];
    const contactIds: string[] = [];
    for (let k = 0; k < n; k++) {
      const i = ++seq;
      const contactId = await createContact({ name: `Contact ${i}`, emails: [`c${i}@venue.test`] });
      const draft = await proposeEmail({ accountId, contactId, to: [`c${i}@venue.test`], subject: `Hola ${i}`, body: `Body ${i}`, origin: "owner" });
      contactIds.push(contactId);
      draftIds.push(draft!.id);
    }
    const campaignId = await createCampaign({ name: "Festival · Propuesta · Oct 5", accountId, draftIds, settings });
    return { campaignId, draftIds, contactIds };
  }

  it("sends nothing before the owner's approval; starting queues the emails", async () => {
    const { campaignId, draftIds } = await campaignOf(3);
    expect(await getCampaign(campaignId)).toMatchObject({
      status: "draft",
      perHour: 10,
      dailyCap: 40,
      windowStart: 9,
      windowEnd: 19,
      weekdaysOnly: true,
      timezone: "Europe/Madrid",
      counts: { proposed: 3, queued: 0, total: 3 },
    });
    expect((await run(MON_10)).sent).toBe(0);
    expect(state.sent).toEqual([]);
    expect(await statuses(campaignId)).toEqual(["proposed", "proposed", "proposed"]);
    // Campaign emails are listed inside their campaign, which counts as one item.
    expect(await listDrafts()).toEqual([]);
    expect((await listDrafts({ campaign: campaignId })).map((d) => d.id)).toEqual(draftIds);
    expect((await listDrafts({ campaign: campaignId }))[0].campaignId).toBe(campaignId);
    expect(await countPendingDrafts()).toBe(1);
    expect((await listCampaigns()).map((c) => c.id)).toEqual([campaignId]);

    await expect(startCampaign(campaignId, { perHour: 0 })).rejects.toThrow(/per hour/);
    expect(await statuses(campaignId)).toEqual(["proposed", "proposed", "proposed"]);

    const started = await startCampaign(campaignId, { perHour: 30, dailyCap: 100 });
    expect(started).toMatchObject({ status: "running", perHour: 30, dailyCap: 100, counts: { queued: 3 } });
    expect(started.startedAt).not.toBeNull();
    expect(await statuses(campaignId)).toEqual(["queued", "queued", "queued"]);
    expect(await countPendingDrafts()).toBe(0);
    await expect(startCampaign(campaignId)).rejects.toThrow(/already sending/);
    const summary = await getCampaignSummary(campaignId, MON_10);
    expect(summary).toMatchObject({ remaining: 3, sentToday: 0, nextSendAt: MON_10.toISOString() });
    expect(summary?.finishEstimate).toBe(minutes(MON_10, 4).toISOString()); // 2 min apart at 30/h
  });

  it("only sends inside the window, in the campaign's timezone, on weekdays", async () => {
    const { campaignId } = await campaignOf(2);
    await startCampaign(campaignId, { perHour: 10 });
    // 08:00 in Madrid: too early.
    expect((await run(new Date("2026-10-05T06:00:00Z"))).campaigns[0]).toMatchObject({ sent: 0, waiting: "window" });
    // Saturday noon.
    expect((await run(new Date("2026-10-10T10:00:00Z"))).campaigns[0]).toMatchObject({ sent: 0, waiting: "window" });
    expect(state.sent).toEqual([]);
    await updateCampaignSettings(campaignId, { weekdaysOnly: false });
    expect((await run(new Date("2026-10-10T10:00:00Z"))).sent).toBe(1);

    // The same instant is 04:00 in New York.
    await updateCampaignSettings(campaignId, { timezone: "America/New_York" });
    expect((await run(new Date("2026-10-12T08:00:00Z"))).campaigns[0]).toMatchObject({ sent: 0, waiting: "window" });
    expect((await run(new Date("2026-10-12T14:00:00Z"))).sent).toBe(1);
    expect(state.sent).toHaveLength(2);
  });

  it("keeps the per-hour gap between sends", async () => {
    const { campaignId } = await campaignOf(4);
    await startCampaign(campaignId, { perHour: 10 }); // 6 min ± 40%, one per run
    expect((await run(MON_10)).sent).toBe(1);
    // Right after, the gap (3.6–8.4 min) is further away than this run's lease allows waiting.
    expect((await run(MON_10)).campaigns[0]).toMatchObject({ sent: 0, waiting: "gap" });
    expect((await run(minutes(MON_10, 9))).sent).toBe(1); // past 8.4 min: at once
    const second = new Date((await getCampaign(campaignId))!.lastSentAt!).getTime();
    expect(second - minutes(MON_10, 9).getTime()).toBeLessThan(5_000); // the clock moves with real time
    expect((await run(minutes(MON_10, 17.5))).sent).toBe(1);
    const third = new Date((await getCampaign(campaignId))!.lastSentAt!).getTime() - second;
    expect(third).toBeGreaterThanOrEqual(216_000);
    expect(third).toBeLessThanOrEqual(8.5 * 60_000 + 5_000);

    // Faster campaigns still never send two emails from the account within 2 minutes.
    await updateCampaignSettings(campaignId, { perHour: 60 });
    await sql`update email_drafts set status = 'proposed' where campaign_id = ${campaignId} and status = 'queued'`;
    const more = await campaignOf(6);
    await startCampaign(more.campaignId, { perHour: 60 });
    const result = await run(minutes(MON_10, 30));
    const sent = result.campaigns.find((c) => c.id === more.campaignId)!.sent;
    expect(sent).toBeGreaterThanOrEqual(1);
    expect(sent).toBeLessThanOrEqual(2);
    const times = await sql<{ sentAt: Date }[]>`
      select sent_at from email_drafts where account_id = ${accountId} and status = 'sent' order by sent_at`;
    for (let i = 1; i < times.length; i++) {
      expect(times[i].sentAt.getTime() - times[i - 1].sentAt.getTime()).toBeGreaterThanOrEqual(120_000);
    }
  });

  it("stops at the daily cap and continues the next day", async () => {
    const { campaignId } = await campaignOf(5);
    await startCampaign(campaignId, { perHour: 60, dailyCap: 2 });
    // Two minutes at least between sends: two cron runs reach the cap.
    const monday = (await run(MON_10)).sent + (await run(minutes(MON_10, 5))).sent;
    expect(monday).toBe(2);
    expect((await run(minutes(MON_10, 10))).campaigns[0]).toMatchObject({ sent: 0, waiting: "daily_cap" });
    expect((await run(minutes(MON_10, 60))).sent).toBe(0);
    expect((await getCampaignSummary(campaignId, minutes(MON_10, 60)))?.sentToday).toBe(2);
    // Tuesday.
    const tuesday = (await run(minutes(MON_10, 24 * 60))).sent + (await run(minutes(MON_10, 24 * 60 + 5))).sent;
    expect(tuesday).toBe(2);
    expect(state.sent).toHaveLength(4);
  });

  it("respects the per-account cap across campaigns", async () => {
    const other = await createCampaign({ name: "Earlier", accountId, draftIds: [] });
    await sql`
      insert into email_drafts (account_id, campaign_id, status, sent_at, to_emails, subject, body_text)
      select ${accountId}, ${other}, 'sent', ${minutes(MON_10, -120)}, '{x@y.test}', 's', 'b' from generate_series(1, ${ACCOUNT_DAILY_SEND_CAP})`;
    const { campaignId } = await campaignOf(2);
    await startCampaign(campaignId, { perHour: 60 });
    expect((await run(MON_10)).campaigns[0]).toMatchObject({ sent: 0, waiting: "account_cap" });
    // 24 hours after those sends, there is room again.
    expect((await run(minutes(MON_10, 23 * 60))).sent).toBeGreaterThan(0);
  });

  it("holds back an email when the contact wrote or was contacted since it was prepared", async () => {
    const { campaignId, draftIds, contactIds } = await campaignOf(3);
    await startCampaign(campaignId, { perHour: 60 });
    const [message] = await sql<{ id: string }[]>`
      insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, sent_at)
      values (${accountId}, 'in1', 'th1', 'inbound', 'c1@venue.test', 'Re: Hola', now())
      returning id`;
    await sql`insert into message_participants (message_id, role, email) values (${message.id}, 'from', 'c1@venue.test')`;
    await addActivity({ kind: "call", outcome: "reached", contactId: contactIds[1] });

    const result = await run(MON_10);
    expect(result).toMatchObject({ sent: 1, held: 2 });
    expect(await statuses(campaignId)).toEqual(["proposed", "proposed", "sent"]);
    expect((await getDraft(draftIds[0]))?.error).toMatch(/^Held back: Contact 1 wrote to you on [A-Z][a-z]{2} \d{1,2} — check before sending\.$/);
    expect((await getDraft(draftIds[1]))?.error).toMatch(/^Held back: a call with Contact 2 was logged on/);
    expect(state.sent.map((s) => s.to)).toEqual([["c3@venue.test"]]);
    // Held-back emails wait for the owner: the campaign needs attention again.
    expect(await countPendingDrafts()).toBe(1);
    // Done when nothing is queued any more. Approving the campaign again does not take the held ones:
    // the owner checks each one.
    expect((await getCampaign(campaignId))?.status).toBe("done");
    expect(await getCampaignSummary(campaignId, MON_10)).toMatchObject({ heldBack: 2, remaining: 0 });
    await expect(startCampaign(campaignId)).rejects.toThrow(/Only held-back emails are left/);
    expect(await statuses(campaignId)).toEqual(["proposed", "proposed", "sent"]);
    // "Queue again" on one: a normal email to approve again (the campaign is done), and the reply
    // that held it back no longer counts.
    expect(await requeueHeldDraft(draftIds[0])).toEqual({ campaignId, queued: false });
    expect(await getDraft(draftIds[0])).toMatchObject({ status: "proposed", error: null });
    await expect(requeueHeldDraft(draftIds[0])).rejects.toThrow(/not held back/);
    expect((await startCampaign(campaignId)).counts).toMatchObject({ queued: 1, proposed: 1 });
    expect((await run(minutes(MON_10, 30))).sent).toBe(1);
    expect(state.sent.map((s) => s.to)).toEqual([["c3@venue.test"], ["c1@venue.test"]]);
    expect(await statuses(campaignId)).toEqual(["sent", "proposed", "sent"]);
  });

  it("queue again: back in a running campaign's queue; a new reply holds it back again", async () => {
    const { campaignId, draftIds } = await campaignOf(2);
    await startCampaign(campaignId, { perHour: 60 });
    const reply = async (id: string) => {
      const [message] = await sql<{ id: string }[]>`
        insert into messages (account_id, gmail_message_id, gmail_thread_id, direction, from_email, subject, sent_at)
        values (${accountId}, ${id}, ${`th-${id}`}, 'inbound', 'c1@venue.test', 'Re: Hola', now())
        returning id`;
      await sql`insert into message_participants (message_id, role, email) values (${message.id}, 'from', 'c1@venue.test')`;
    };
    await reply("r1");
    await sql`update email_campaigns set per_hour = 1 where id = ${campaignId}`; // one send per run
    expect(await run(MON_10)).toMatchObject({ sent: 1, held: 1 });
    expect(await statuses(campaignId)).toEqual(["proposed", "sent"]);
    expect((await getCampaign(campaignId))?.status).toBe("running");
    // Only a held-back email can be queued again; not one of another status or outside a campaign.
    await expect(requeueHeldDraft(draftIds[1])).rejects.toThrow(/not held back/);
    expect(await requeueHeldDraft(draftIds[0])).toEqual({ campaignId, queued: true });
    expect(await statuses(campaignId)).toEqual(["queued", "sent"]);
    // An edit keeps a held-back email held back (its reason and "Queue again" stay).
    await sql`update email_drafts set status = 'proposed', error = 'Held back: Contact 1 wrote to you on Oct 2 — check before sending.' where id = ${draftIds[0]}`;
    await saveDraftEdits(draftIds[0], { subject: "Hola 1", body: "Edited after their reply", to: ["c1@venue.test"], cc: [] });
    expect((await getDraft(draftIds[0]))?.error).toMatch(/^Held back: Contact 1/);
    expect(await requeueHeldDraft(draftIds[0])).toEqual({ campaignId, queued: true });
    // They write again after the owner's check: held back again, nothing sent.
    await new Promise((r) => setTimeout(r, 5));
    await reply("r2");
    expect(await run(minutes(MON_10, 120))).toMatchObject({ sent: 0, held: 1 });
    expect(await statuses(campaignId)).toEqual(["proposed", "sent"]);
    expect(state.sent).toHaveLength(1);
  });

  it("pauses after three failed sends in a row", async () => {
    const { campaignId } = await campaignOf(4);
    await startCampaign(campaignId, { perHour: 60 });
    state.failSend = new GmailApiError(500, "Backend Error");
    expect((await run(MON_10)).campaigns[0]).toMatchObject({ failed: 1, status: "running", waiting: "failure" });
    expect((await getCampaign(campaignId))?.consecutiveFailures).toBe(1);
    await run(minutes(MON_10, 5));
    const third = await run(minutes(MON_10, 10));
    expect(third.campaigns[0]).toMatchObject({ failed: 1, status: "paused" });
    const paused = await getCampaign(campaignId);
    expect(paused).toMatchObject({ status: "paused", consecutiveFailures: 3 });
    expect(paused?.error).toMatch(/Paused after 3 failed sends in a row/);
    expect(await statuses(campaignId)).toEqual(["failed", "failed", "failed", "queued"]);
    expect(state.sent).toEqual([]);
    expect((await run(minutes(MON_10, 15))).sent).toBe(0); // paused: nothing
    expect(await countPendingDrafts()).toBe(1);

    // Resume: the queued one goes; failed ones stay failed until approved again.
    state.failSend = null;
    expect((await resumeCampaign(campaignId)).consecutiveFailures).toBe(0);
    expect((await run(minutes(MON_10, 20))).sent).toBe(1);
    expect(await statuses(campaignId)).toEqual(["failed", "failed", "failed", "sent"]);
  });

  it("pauses when the account needs reconnecting", async () => {
    const { campaignId } = await campaignOf(3);
    await startCampaign(campaignId, { perHour: 60 });
    await sql`update gmail_accounts set status = 'reauth_required' where id = ${accountId}`;
    expect((await run(MON_10)).campaigns[0]).toMatchObject({ sent: 0, status: "paused", waiting: "account" });
    expect((await getCampaign(campaignId))?.error).toBe("Reconnect me@own.test in Settings to resume sending.");
    expect(await statuses(campaignId)).toEqual(["queued", "queued", "queued"]);
    await expect(resumeCampaign(campaignId)).rejects.toThrow(/Reconnect me@own.test/);

    // Revoked in the middle of a send.
    await sql`update gmail_accounts set status = 'active' where id = ${accountId}`;
    await resumeCampaign(campaignId);
    state.beforeSend = async () => {
      await sql`update gmail_accounts set status = 'reauth_required' where id = ${accountId}`;
      throw new Error("Google access was revoked");
    };
    expect((await run(MON_10)).campaigns[0]).toMatchObject({ failed: 1, status: "paused", waiting: "account" });
    expect(state.sent).toEqual([]);
  });

  it("never sends twice from overlapping runs (lease)", async () => {
    const { campaignId } = await campaignOf(8);
    await startCampaign(campaignId, { perHour: 60 });
    const [a, b] = await Promise.all([run(MON_10), run(MON_10)]);
    const waiting = [a.campaigns[0].waiting, b.campaigns[0].waiting];
    expect(waiting).toContain("locked");
    expect(a.sent + b.sent).toBe(state.sent.length);
    expect(new Set(state.sent.map((s) => s.draftId)).size).toBe(state.sent.length);
    expect(state.sent.length).toBeLessThanOrEqual(5);
    // A live lease (another run in progress) skips the campaign; it is released afterwards.
    await sql`update email_campaigns set locked_until = now() + interval '3 minutes' where id = ${campaignId}`;
    expect((await run(minutes(MON_10, 10))).campaigns[0]).toMatchObject({ waiting: "locked", sent: 0 });
    await sql`update email_campaigns set locked_until = now() - interval '1 second' where id = ${campaignId}`;
    expect((await run(minutes(MON_10, 10))).sent).toBeGreaterThan(0);
    const [{ lockedUntil }] = await sql<{ lockedUntil: Date | null }[]>`select locked_until from email_campaigns where id = ${campaignId}`;
    expect(lockedUntil).toBeNull();
  });

  it("a run that overran its lease leaves the next run's lease alone", async () => {
    const { campaignId } = await campaignOf(2);
    await startCampaign(campaignId, { perHour: 12 }); // one send per run
    // While this run sends, its lease expires and another run takes the campaign.
    state.beforeSend = async () => {
      await sql`update email_campaigns set locked_until = now() + interval '3 minutes' where id = ${campaignId}`;
    };
    expect((await run(MON_10)).sent).toBe(1);
    const [{ locked }] = await sql<{ locked: boolean }[]>`select locked_until > now() as locked from email_campaigns where id = ${campaignId}`;
    expect(locked).toBe(true);
    expect((await run(minutes(MON_10, 10))).campaigns[0]).toMatchObject({ waiting: "locked", sent: 0 });
  });

  it("finishes when nothing is queued", async () => {
    const { campaignId } = await campaignOf(2);
    await startCampaign(campaignId, { perHour: 60 });
    // Two minutes at least between sends: the second email (and the finish) can take a second run.
    await run(MON_10);
    await run(minutes(MON_10, 5));
    await run(minutes(MON_10, 10));
    const done = await getCampaign(campaignId);
    expect(done).toMatchObject({ status: "done", counts: { sent: 2, queued: 0 } });
    expect(done?.finishedAt).not.toBeNull();
    expect(await listCampaigns()).toEqual([]); // nothing left for the owner
    expect((await listCampaigns({ statuses: ["done"] })).map((c) => c.id)).toEqual([campaignId]);
    expect((await run(minutes(MON_10, 30))).campaigns).toEqual([]);
  });

  it("cancel returns queued emails to the owner; pause holds them", async () => {
    const { campaignId } = await campaignOf(4);
    await startCampaign(campaignId, { perHour: 10 });
    expect((await run(MON_10)).sent).toBe(1);
    await pauseCampaign(campaignId);
    expect((await run(minutes(MON_10, 30))).sent).toBe(0);
    expect(await statuses(campaignId)).toEqual(["sent", "queued", "queued", "queued"]);
    await resumeCampaign(campaignId);
    await cancelCampaign(campaignId);
    expect(await getCampaign(campaignId)).toMatchObject({ status: "cancelled", counts: { proposed: 3, queued: 0, sent: 1 } });
    expect((await run(minutes(MON_10, 60))).sent).toBe(0);
    expect(state.sent).toHaveLength(1);
    expect(await countPendingDrafts()).toBe(1);
    // A cancelled campaign can be approved again, or discarded.
    expect(await discardCampaign(campaignId)).toBe(3);
    expect(await statuses(campaignId)).toEqual(["sent", "discarded", "discarded", "discarded"]);
    expect(state.drafts.size).toBe(0);
    expect(await countPendingDrafts()).toBe(0);
  });

  it("sends the edited version of a queued email; a discarded one is skipped", async () => {
    const { campaignId, draftIds } = await campaignOf(3);
    await startCampaign(campaignId, { perHour: 60 });
    const edited = await saveDraftEdits(draftIds[0], { subject: "Hola 1", body: "Edited body", to: ["c1@venue.test"], cc: [] });
    expect(edited.status).toBe("queued");
    await discardDraft(draftIds[1]);
    // Sends are at least 2 minutes apart from one account: two cron runs.
    await run(MON_10);
    await run(minutes(MON_10, 5));
    expect(state.sent.map((s) => s.body)).toEqual(["Edited body", "Body 3"]);
    expect(await statuses(campaignId)).toEqual(["sent", "discarded", "sent"]);
    await expect(saveDraftEdits(draftIds[0], { subject: "x", body: "y", to: ["c1@venue.test"], cc: [] })).rejects.toThrow(/no longer be edited/);
  });

  it("only ever sends queued emails of running campaigns", async () => {
    const { campaignId, draftIds } = await campaignOf(2);
    // Not started: the scheduler path refuses, nothing is sent.
    await expect(approveAndSend(draftIds[0], { from: ["queued"], campaignId })).rejects.toBeInstanceOf(DraftUnavailableError);
    await startCampaign(campaignId, { perHour: 60 });
    await pauseCampaign(campaignId);
    await expect(approveAndSend(draftIds[0], { from: ["queued"], campaignId })).rejects.toBeInstanceOf(DraftUnavailableError);
    expect(state.sent).toEqual([]);
    // The owner's "Send now" on a queued email works (an explicit approval).
    await approveAndSend(draftIds[0]);
    expect(state.sent).toHaveLength(1);
    // A queued email whose campaign is no longer sending goes back to the owner.
    await sql`update email_campaigns set status = 'cancelled' where id = ${campaignId}`;
    const result = await run(MON_10);
    expect(result.released).toBe(1);
    expect((await getDraft(draftIds[1]))).toMatchObject({ status: "proposed", error: expect.stringMatching(/no longer sending/) });
    expect(state.sent).toHaveLength(1);
  });
});
