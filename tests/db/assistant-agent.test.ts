import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Gmail draft side effects: recorded, never sent. */
const state = vi.hoisted(() => ({
  drafts: new Map<string, { to: string[]; subject: string; body: string }>(),
  sent: [] as { to: string[]; body: string }[],
  next: 0,
}));

vi.mock("@/lib/sync/drafts", async () => {
  class DraftError extends Error {}
  return {
    DraftError,
    saveGmailDraft: vi.fn(async (p: { to: string[]; subject: string; body: string }) => {
      const id = `d${++state.next}`;
      state.drafts.set(id, { to: p.to, subject: p.subject, body: p.body });
      return { draftId: id, gmailUrl: "https://mail.google.com/" };
    }),
    updateGmailDraft: vi.fn(async (p: { draftId: string; to: string[]; subject: string; body: string }) => {
      state.drafts.set(p.draftId, { to: p.to, subject: p.subject, body: p.body });
      return { draftId: p.draftId, gmailUrl: "https://mail.google.com/" };
    }),
    sendGmailDraft: vi.fn(async (_accountId: string, draftId: string) => {
      const d = state.drafts.get(draftId)!;
      state.sent.push({ to: d.to, body: d.body });
      return { gmailMessageId: `sent-${draftId}`, gmailThreadId: "t1" };
    }),
    deleteGmailDraft: vi.fn(async (_a: string, id: string) => void state.drafts.delete(id)),
  };
});

import { sql } from "@/lib/db";
import { GET as contextRoute } from "@/app/api/assistant-agent/context/route";
import { POST as proposalsRoute } from "@/app/api/assistant-agent/proposals/route";
import { GET as contactsRoute, POST as contactsPost } from "@/app/api/assistant-agent/contacts/route";
import { POST as runsRoute } from "@/app/api/assistant-agent/runs/route";
import { GET as historyRoute } from "@/app/api/assistant-agent/history/route";
import { GET as rowsListRoute, POST as rowsRoute } from "@/app/api/assistant-agent/rows/route";
import { GET as prospectsRoute } from "@/app/api/assistant-agent/prospects/route";
import { listAssistantRuns } from "@/lib/assistant/runs";
import { postponeDraft, requestDraftChanges } from "@/lib/assistant/drafts";
import { addSheetRow, createSheet } from "@/lib/queries/booking";
import { getDraft } from "@/lib/queries/drafts";
import { addActionComment, listAssistantActions, listAssistantDrafts, releasePostponed } from "@/lib/queries/assistant";
import { insertAccount, useTestDatabase } from "../setup/db";

describe("campaign assistant API", () => {
  useTestDatabase();

  const TOKEN = "test-assistant-token-0123456789";
  const URL_BASE = "http://localhost:3000/api/assistant-agent";

  function get(token: string | null = TOKEN) {
    return contextRoute(new Request(`${URL_BASE}/context`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
  }

  function post(body: unknown, token: string | null = TOKEN) {
    return proposalsRoute(
      new Request(`${URL_BASE}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  }

  /** Contact cards filled, as the routine does before writing (otherwise its emails are skipped). */
  async function fillCards() {
    await sql`update contacts set researched_at = now()`;
    await sql`update organizations set profile = '{"summary": "A venue."}'::jsonb`;
  }

  async function seed(rows = 2, active = true, cards = true) {
    await insertAccount("me@example.com");
    const projectId = await createSheet({ name: "Gira 2027", currency: "EUR" });
    await sql`update projects set assistant_active = ${active}, assistant_brief = 'Book 10 dates in autumn' where id = ${projectId}`;
    const ids: string[] = [];
    for (let i = 0; i < rows; i++) {
      ids.push(
        await addSheetRow({
          projectId,
          organization: `Venue ${i}`,
          email: `booker${i}@venue${i}.org`,
          contactName: `Booker ${i}`,
          phone: "+34600000000",
        }),
      );
    }
    if (cards) await fillCards();
    return { projectId, ids };
  }

  const email = (opportunityId: string, n = 0) => ({
    opportunityId,
    subject: `Autumn dates ${n}`,
    body: `Hello ${n}`,
    reason: "No reply in 12 days",
    priority: 1,
  });

  beforeEach(() => {
    process.env.ASSISTANT_API_TOKEN = TOKEN;
    state.drafts.clear();
    state.sent.length = 0;
  });
  afterEach(() => {
    delete process.env.ASSISTANT_API_TOKEN;
  });

  describe("assistant API auth", () => {
    it("is 404 while the token is unset, 401 without or with a wrong token", async () => {
      delete process.env.ASSISTANT_API_TOKEN;
      expect((await get()).status).toBe(404);
      expect((await post({})).status).toBe(404);
      process.env.ASSISTANT_API_TOKEN = TOKEN;
      expect((await get(null)).status).toBe(401);
      expect((await get("nope")).status).toBe(401);
      expect((await post({}, "nope")).status).toBe(401);
      expect((await get()).status).toBe(200);
    });
  });

  describe("GET context", () => {
    it("lists active sheets only, with rows, brief and what is already proposed", async () => {
      const { projectId, ids } = await seed(2);
      const paused = await createSheet({ name: "Paused sheet" });
      await addSheetRow({ projectId: paused, organization: "Other", email: "x@other.org" });
      await post({ projectId, emails: [email(ids[0])], actions: [{ opportunityId: ids[1], kind: "call", title: "Call Booker 1", priority: 2 }] });

      const body = await (await get()).json();
      expect(body.projects).toHaveLength(1);
      const p = body.projects[0];
      expect(p).toMatchObject({ id: projectId, name: "Gira 2027", brief: "Book 10 dates in autumn", currency: "EUR" });
      expect(p.rows).toHaveLength(2);
      const row = p.rows.find((r: { opportunityId: string }) => r.opportunityId === ids[0]);
      expect(row.contact).toMatchObject({ email: "booker0@venue0.org", phone: "+34600000000" });
      expect(row.openDraft).toMatchObject({ status: "proposed" });
      expect(p.pendingDrafts).toHaveLength(1);
      expect(p.openActions.map((a: { kind: string }) => a.kind).sort()).toEqual(["call", "email"]);
      expect(body.limits.maxEmailsPerProjectPerCall).toBe(10);
    });
  });

  describe("POST proposals", () => {
    it("rejects paused campaigns and invalid bodies", async () => {
      const { projectId, ids } = await seed(1, false);
      const res = await post({ projectId, emails: [email(ids[0])] });
      expect(res.status).toBe(409);
      expect((await post({ projectId: "nope" })).status).toBe(400);
      expect((await post({ projectId, emails: [{ opportunityId: ids[0] }] })).status).toBe(400);
      const [{ count }] = await sql<{ count: number }[]>`select count(*)::int from email_drafts`;
      expect(count).toBe(0);
    });

    it("creates proposals with a reason and an email action, never sends, and skips rows that already have one", async () => {
      const { projectId, ids } = await seed(2);
      const res = await post({
        projectId,
        emails: [email(ids[0]), email(ids[1], 1)],
        actions: [{ opportunityId: ids[0], kind: "whatsapp", title: "WhatsApp Booker 0" }],
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.created.emails).toHaveLength(2);
      expect(body.created.actions).toHaveLength(1);
      const draft = await getDraft(body.created.emails[0].draftId);
      expect(draft).toMatchObject({ status: "proposed", origin: "assistant", assistantReason: "No reply in 12 days", to: ["booker0@venue0.org"] });
      expect(state.sent).toHaveLength(0);

      // Second run: same rows → skipped (open), duplicate action skipped too.
      const again = await (
        await post({ projectId, emails: [email(ids[0])], actions: [{ opportunityId: ids[0], kind: "whatsapp", title: "Again" }] })
      ).json();
      expect(again.created.emails).toHaveLength(0);
      expect(again.created.actions).toHaveLength(0);
      expect(again.skipped.map((s: { type: string }) => s.type).sort()).toEqual(["action", "email"]);

      // Postponed still counts as open.
      await postponeDraft(body.created.emails[1].draftId);
      const third = await (await post({ projectId, emails: [email(ids[1])] })).json();
      expect(third.created.emails).toHaveLength(0);

      const [{ lastRun }] = await sql<{ lastRun: Date | null }[]>`select assistant_last_run_at as last_run from projects where id = ${projectId}`;
      expect(lastRun).not.toBeNull();
    });

    it("replies in the contact's thread when the subject continues one", async () => {
      const { projectId, ids } = await seed(2);
      const [{ id: accountId }] = await sql<{ id: string }[]>`select id from gmail_accounts where email = 'me@example.com'`;
      const message = async (gmailId: string, from: string, to: string, subject: string, sentAt: string) => {
        const [row] = await sql<{ id: string }[]>`
          insert into messages (account_id, gmail_message_id, gmail_thread_id, rfc822_message_id, direction, from_email, subject, snippet, sent_at)
          values (${accountId}, ${gmailId}, ${`t-${gmailId}`}, ${`<${gmailId}@test>`}, ${from === "me@example.com" ? "outbound" : "inbound"}, ${from}, ${subject}, ${subject}, ${sentAt})
          returning id`;
        await sql`insert into message_participants (message_id, role, email) values (${row.id}, 'from', ${from}), (${row.id}, 'to', ${to})`;
        return row.id;
      };
      await message("m1", "me@example.com", "booker0@venue0.org", "European collaboration", "2026-09-01T10:00:00Z");
      const latest = await message("m2", "booker0@venue0.org", "me@example.com", "RE: European  collaboration", "2026-09-03T10:00:00Z");
      await message("m3", "booker0@venue0.org", "me@example.com", "Something else", "2026-09-05T10:00:00Z");
      await message("m4", "booker1@venue1.org", "me@example.com", "Hello", "2026-09-05T10:00:00Z");

      const body = await (
        await post({
          projectId,
          emails: [
            { ...email(ids[0]), subject: "Re: European collaboration" },
            { ...email(ids[1]), subject: "Autumn dates" },
          ],
        })
      ).json();
      const [reply, fresh] = await Promise.all(body.created.emails.map((e: { draftId: string }) => getDraft(e.draftId)));
      expect(reply).toMatchObject({ replyToMessageId: latest, accountId });
      expect(fresh?.replyToMessageId).toBeNull();
    });

    it("fills the contact card before any email: empty fields only, with sources", async () => {
      const { projectId, ids } = await seed(1, true, false);
      const contacts = (path = "") =>
        contactsRoute(new Request(`${URL_BASE}/contacts?projectId=${projectId}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } }));
      const cards = (body: unknown) =>
        contactsPost(
          new Request(`${URL_BASE}/contacts`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
            body: JSON.stringify(body),
          }),
        );

      // Not filled yet: the email waits.
      const first = await (await post({ projectId, emails: [email(ids[0])] })).json();
      expect(first.created.emails).toHaveLength(0);
      expect(first.skipped[0].reason).toMatch(/Fill the contact card first/);
      const listed = await (await contacts("&unresearched=1")).json();
      expect(listed.contacts).toHaveLength(1);
      expect(listed.contacts[0]).toMatchObject({ researchedAt: null, cardMissing: ["role", "organizationProfile", "photo"] });

      // Facts need their source.
      const unsourced = await (await cards({ contacts: [{ email: "booker0@venue0.org", role: "Artistic director" }] })).json();
      expect(unsourced.results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/^sources/) });

      await sql`update contacts set notes = 'Met in Bilbao'`;
      const filled = await (
        await cards({
          contacts: [
            {
              email: "booker0@venue0.org",
              name: "Someone Else",
              role: "Artistic director",
              phone: "+34 611 222 333",
              notes: "Programs early music — mostly Baroque.",
              sources: ["https://venue0.org/team"],
            },
          ],
        })
      ).json();
      expect(filled.results[0]).toMatchObject({ ok: true, filled: ["role", "notes"], kept: ["name", "phone"] });
      const [c] = await sql<{ name: string; role: string; phone: string; notes: string; researchSources: string[] }[]>`
        select name, role, phone, notes, research_sources from contacts`;
      expect(c).toMatchObject({ name: "Booker 0", role: "Artistic director", phone: "+34600000000", researchSources: ["https://venue0.org/team"] });
      expect(c.notes).toBe("Met in Bilbao\n\nPrograms early music, mostly Baroque.");

      // The organization still has no profile.
      const second = await (await post({ projectId, emails: [email(ids[0])] })).json();
      expect(second.skipped[0].reason).toMatch(/organization's profile first/);
      await sql`update organizations set profile = '{"summary": "A venue."}'::jsonb`;
      const third = await (await post({ projectId, emails: [email(ids[0])] })).json();
      expect(third.created.emails).toHaveLength(1);
      expect((await (await contacts("&unresearched=1")).json()).contacts).toHaveLength(0);
    });

    it("answers the owner's change requests before any new email, keeps a reply's subject and records the run", async () => {
      const { projectId, ids } = await seed(2);
      const run = (body: unknown) =>
        runsRoute(
          new Request(`${URL_BASE}/runs`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
            body: JSON.stringify(body),
          }),
        );
      const { runId } = await (await run({ action: "start", model: "test-model" })).json();
      expect(runId).toBeTruthy();

      // A reply in a thread (its subject has an en dash, which must survive).
      const [{ id: accountId }] = await sql<{ id: string }[]>`select id from gmail_accounts`;
      const [msg] = await sql<{ id: string }[]>`
        insert into messages (account_id, gmail_message_id, gmail_thread_id, rfc822_message_id, direction, from_email, subject, snippet, sent_at)
        values (${accountId}, 'r1', 't-r1', '<r1@test>', 'inbound', 'booker0@venue0.org', 'Collaboration – ADAR 2027', 'Hi', now() - interval '1 day')
        returning id`;
      await sql`insert into message_participants (message_id, role, email) values (${msg.id}, 'from', 'booker0@venue0.org'), (${msg.id}, 'to', 'me@example.com')`;
      const first = await (await post({ projectId, emails: [{ ...email(ids[0]), subject: "Re: Collaboration - ADAR 2027" }] })).json();
      const draftId = first.created.emails[0].draftId;
      expect((await getDraft(draftId))?.subject).toBe("Re: Collaboration – ADAR 2027");

      await requestDraftChanges(draftId, "Never say producer; propose a concrete idea");
      const ctx = await (await get()).json();
      expect(ctx.ownerLessons[0]).toMatchObject({ request: "Never say producer; propose a concrete idea", contact: "Booker 0" });

      // A new email while the change request is unanswered: refused.
      const blocked = await (await post({ projectId, emails: [email(ids[1], 1)] })).json();
      expect(blocked.created.emails).toHaveLength(0);
      expect(blocked.skipped[0].reason).toMatch(/change requests first/);
      expect(blocked.pendingRevisions).toEqual([{ draftId, revisionRequest: "Never say producer; propose a concrete idea" }]);

      // Revision and new email in one call: the revision goes first, then the email is accepted.
      const both = await (
        await post({
          projectId,
          revisions: [
            {
              draftId,
              subject: "Re: Collaboration - ADAR 2027",
              body: "A concrete idea",
              noteToOwner: "Checked their season: they program dance — and music.",
            },
          ],
          emails: [email(ids[1], 1)],
        })
      ).json();
      expect(both.created.revisions).toEqual([{ draftId }]);
      expect(both.created.emails).toHaveLength(1);
      expect(both.pendingRevisions).toEqual([]);
      expect(await getDraft(draftId)).toMatchObject({
        subject: "Re: Collaboration – ADAR 2027",
        body: "A concrete idea",
        assistantReason: "Checked their season: they program dance, and music.",
      });

      await run({ action: "finish", report: "Revisé 1 email y propuse 1." });
      const [logged] = await listAssistantRuns();
      expect(logged).toMatchObject({ id: runId, model: "test-model", report: "Revisé 1 email y propuse 1." });
      expect(logged.finishedAt).not.toBeNull();
      expect(logged.calls.map((c) => c.endpoint)).toEqual(["proposals", "proposals", "proposals"]);
      expect(logged.calls[1].response).toMatchObject({ pendingRevisions: [{ draftId }] });
    });

    it("answers the owner's comments on actions before any new email, and updates or closes the action", async () => {
      const { projectId, ids } = await seed(3);
      const made = await (
        await post({
          projectId,
          actions: [
            { opportunityId: ids[0], kind: "call", title: "Llamar a Booker 0", reason: "No contesta emails", priority: 1 },
            { opportunityId: ids[1], kind: "whatsapp", title: "WhatsApp a Booker 1", priority: 2 },
          ],
        })
      ).json();
      const [callId, whatsappId] = made.created.actions.map((a: { actionId: string }) => a.actionId);

      expect(await addActionComment(callId, "Ya le llamé ayer, mejor un email con las fechas de marzo")).toBe(true);
      expect(await addActionComment(whatsappId, "Espera a enero")).toBe(true);
      const [listed] = (await listAssistantActions({ projectId })).filter((a) => a.id === callId);
      expect(listed.comments).toEqual([expect.objectContaining({ by: "owner", text: "Ya le llamé ayer, mejor un email con las fechas de marzo" })]);

      // The writer sees them in its context, and as owner lessons.
      const ctx = await (await get()).json();
      expect(ctx.projects[0].actionComments.map((c: { actionId: string }) => c.actionId).sort()).toEqual([callId, whatsappId].sort());
      expect(ctx.ownerLessons.map((l: { request: string }) => l.request)).toContain("Espera a enero");

      // New emails wait until every comment is answered.
      const blocked = await (await post({ projectId, emails: [email(ids[2], 2)] })).json();
      expect(blocked.created.emails).toHaveLength(0);
      expect(blocked.skipped[0].reason).toMatch(/comments on actions first/);
      expect(blocked.pendingActionComments).toHaveLength(2);

      // Answers in one call: one closes the action, one updates it; then the email goes through.
      const answered = await (
        await post({
          projectId,
          actionReplies: [
            { actionId: callId, reply: "Entendido — preparo el email con las fechas de marzo y cierro la llamada.", status: "done" },
            { actionId: whatsappId, reply: "De acuerdo, lo retomo en enero.", title: "WhatsApp a Booker 1 en enero", priority: 3 },
            { actionId: whatsappId, reply: "Twice" },
          ],
          emails: [email(ids[2], 2)],
        })
      ).json();
      expect(answered.created.actionReplies).toEqual([{ actionId: callId }, { actionId: whatsappId }]);
      expect(answered.skipped).toEqual([
        expect.objectContaining({ type: "actionReply", ref: whatsappId, reason: expect.stringMatching(/No comment/) }),
      ]);
      expect(answered.pendingActionComments).toEqual([]);
      expect(answered.created.emails).toHaveLength(1);

      const [call] = await sql<{ status: string; completedAt: Date | null; comments: { by: string; text: string }[] }[]>`
        select status, completed_at, comments from assistant_actions where id = ${callId}`;
      expect(call.status).toBe("done");
      expect(call.completedAt).not.toBeNull();
      expect(call.comments.map((c) => c.by)).toEqual(["owner", "assistant"]);
      expect(call.comments[1].text).toBe("Entendido, preparo el email con las fechas de marzo y cierro la llamada.");
      const [whatsapp] = await listAssistantActions({ projectId }).then((all) => all.filter((a) => a.id === whatsappId));
      expect(whatsapp).toMatchObject({ status: "open", title: "WhatsApp a Booker 1 en enero", priority: 3 });
      expect((await (await get()).json()).projects[0].actionComments).toEqual([]);
    });

    it("history: every earlier email with the person, from all mailboxes, mass emails summarised", async () => {
      await seed(1);
      const josefina = await insertAccount("josefina@example.com", { monitor_only: true });
      const [{ id: me }] = await sql<{ id: string }[]>`select id from gmail_accounts where email = 'me@example.com'`;
      const add = async (account: string, gid: string, from: string, to: string[], subject: string, at: string) => {
        const [m] = await sql<{ id: string }[]>`
          insert into messages (account_id, gmail_message_id, gmail_thread_id, rfc822_message_id, direction, from_email, subject, snippet, body_text, sent_at)
          values (${account}, ${gid}, ${`t-${gid}`}, ${`<${gid}@test>`}, ${from.startsWith("booker") ? "inbound" : "outbound"}, ${from}, ${subject}, ${subject}, ${`Body of ${subject}`}, ${at})
          returning id`;
        await sql`insert into message_participants (message_id, role, email) values (${m.id}, 'from', ${from})`;
        for (const e of to) await sql`insert into message_participants (message_id, role, email) values (${m.id}, 'to', ${e})`;
      };
      await add(josefina, "j1", "josefina@example.com", ["booker0@venue0.org"], "Season 2025", "2025-01-10T10:00:00Z");
      await add(
        me,
        "g1",
        "me@example.com",
        ["booker0@venue0.org", "a@x.org", "b@x.org", "c@x.org", "d@x.org", "e@x.org"],
        "Newsletter",
        "2025-06-01T10:00:00Z",
      );
      await add(me, "g2", "booker0@venue0.org", ["me@example.com"], "Re: Season 2025", "2025-01-12T10:00:00Z");
      const [{ contactId }] = await sql<{ contactId: string }[]>`select contact_id from contact_emails where email = 'booker0@venue0.org'`;
      const res = await historyRoute(new Request(`${URL_BASE}/history?contactId=${contactId}`, { headers: { authorization: `Bearer ${TOKEN}` } }));
      const body = await res.json();
      expect(body.messages.map((m: { subject: string }) => m.subject)).toEqual(["Newsletter", "Re: Season 2025", "Season 2025"]);
      expect(body.messages[0]).toMatchObject({ bulk: true, recipients: 6, to: ["(mass email to 6 people)"] });
      expect(body.messages[2]).toMatchObject({ mailbox: "josefina@example.com", direction: "outbound", body: "Body of Season 2025" });
      expect((await historyRoute(new Request(`${URL_BASE}/history`, { headers: { authorization: `Bearer ${TOKEN}` } }))).status).toBe(400);
    });

    it("prospector: finds people we wrote to, adds them as rows without duplicates, logged in its own run", async () => {
      const { projectId } = await seed(1);
      const [{ id: me }] = await sql<{ id: string }[]>`select id from gmail_accounts where email = 'me@example.com'`;
      const send = async (gid: string, to: string, subject: string, body: string) => {
        const [m] = await sql<{ id: string }[]>`
          insert into messages (account_id, gmail_message_id, gmail_thread_id, rfc822_message_id, direction, from_email, subject, snippet, body_text, sent_at)
          values (${me}, ${gid}, ${`t-${gid}`}, ${`<${gid}@test>`}, 'outbound', 'me@example.com', ${subject}, ${subject}, ${body}, now() - interval '30 days')
          returning id`;
        await sql`insert into message_participants (message_id, role, email) values (${m.id}, 'from', 'me@example.com'), (${m.id}, 'to', ${to})`;
      };
      await send("p1", "series@chamber.org", "Chamber series proposal", "Our piano quintet for your chamber music series");
      await send("p2", "friend@family.com", "Dinner", "See you on Sunday");
      await send("p3", "booker0@venue0.org", "Season", "Chamber music"); // already a row

      const headers = { authorization: `Bearer ${TOKEN}` };
      const all = await (await prospectsRoute(new Request(`${URL_BASE}/prospects?projectId=${projectId}`, { headers }))).json();
      expect(all.prospects.map((p: { email: string }) => p.email).sort()).toEqual(["friend@family.com", "series@chamber.org"]);
      const chamber = await (await prospectsRoute(new Request(`${URL_BASE}/prospects?projectId=${projectId}&q=chamber`, { headers }))).json();
      expect(chamber.prospects).toEqual([
        expect.objectContaining({ email: "series@chamber.org", sentCount: 1, receivedCount: 0, mailboxes: ["me@example.com"] }),
      ]);

      const run = (body: unknown, extra: Record<string, string> = {}) =>
        runsRoute(
          new Request(`${URL_BASE}/runs`, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers, ...extra },
            body: JSON.stringify(body),
          }),
        );
      const { runId: writer } = await (await run({ action: "start" })).json();
      const { runId: prospector } = await (await run({ action: "start", agent: "prospector" })).json();
      const rows = (body: unknown) =>
        rowsRoute(
          new Request(`${URL_BASE}/rows`, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers, "x-assistant-run": prospector },
            body: JSON.stringify(body),
          }),
        );
      const res = await (
        await rows({
          projectId,
          rows: [
            {
              organization: "Chamber Series",
              website: "https://www.chamber.org/season",
              email: "series@chamber.org",
              contactName: "Ann Lee",
              source: "email_history",
              reason: "We wrote in 2025 — no answer yet.",
            },
            { organization: "Venue 0", source: "research", reason: "Same organization as an existing row." },
            { organization: "Other name", website: "chamber.org/about", source: "owner_list", reason: "Same website as the first one." },
            { organization: "New Festival", source: "nope", reason: "x" },
          ],
        })
      ).json();
      expect(res.created).toBe(1);
      expect(res.results.map((r: { ok: boolean; error?: string }) => r.ok || r.error)).toEqual([
        true,
        "Already in this campaign (same organization).",
        "Already in this campaign (same organization).",
        expect.stringMatching(/^source/),
      ]);
      const [row] = await sql<{ section: string; notes: string; stage: string }[]>`
        select sheet_section as section, notes, stage from opportunities where id = ${res.results[0].opportunityId}`;
      expect(row).toEqual({
        section: "Nuevos · de nuestro email",
        stage: "lead",
        notes: "Origen: de nuestro email. We wrote in 2025, no answer yet.",
      });

      // Both runs open at once: the call went to the prospector's run, not the writer's.
      const logged = await listAssistantRuns();
      expect(logged.find((r) => r.id === prospector)).toMatchObject({ agent: "prospector", calls: [expect.objectContaining({ endpoint: "rows" })] });
      expect(logged.find((r) => r.id === writer)).toMatchObject({ agent: "writer", calls: [] });
    });

    it("owner lists: rows with their section, follow-up date and history, then the prospector attaches the contact", async () => {
      const { projectId } = await seed(1);
      const headers = { "content-type": "application/json", authorization: `Bearer ${TOKEN}` };
      const rows = async (body: unknown) =>
        (await rowsRoute(new Request(`${URL_BASE}/rows`, { method: "POST", headers, body: JSON.stringify(body) }))).json();
      const added = await rows({
        projectId,
        rows: [
          {
            organization: "Louisville Chamber Music",
            source: "owner_list",
            reason: "Lista de Josefina 2025: concierto confirmado.",
            section: "Listas · 1 ya tocamos",
            followUpAt: "2027-03-15",
            returning: true,
          },
          { organization: "Bad Section", source: "owner_list", reason: "x", section: "Otra" },
        ],
      });
      expect(added.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false]);
      const rowId = added.results[0].opportunityId;
      const [row] = await sql<{ section: string; followUpAt: string; isReturning: boolean; contactId: string | null }[]>`
        select sheet_section as section, follow_up_at::text as follow_up_at, is_returning, contact_id from opportunities where id = ${rowId}`;
      expect(row).toEqual({ section: "Listas · 1 ya tocamos", followUpAt: "2027-03-15", isReturning: true, contactId: null });

      // The prospector found the person: attached to the row.
      const attached = await rows({
        projectId,
        rows: [
          {
            opportunityId: rowId,
            email: "Director@LouisvilleCM.org",
            contactName: "Pat Doe",
            role: "Executive Director",
            reason: "Equipo en su web.",
          },
          { opportunityId: rowId, email: "other@louisvillecm.org", reason: "Second time." },
        ],
      });
      expect(attached.results[0]).toMatchObject({ ok: true, opportunityId: rowId });
      expect(attached.results[1]).toMatchObject({ ok: false, error: expect.stringMatching(/already has a contact/) });
      const [contact] = await sql<{ name: string; role: string; email: string; inProject: boolean }[]>`
        select c.name, c.role, ce.email, exists (select 1 from contact_projects cp where cp.contact_id = c.id and cp.project_id = ${projectId}) as in_project
          from opportunities op join contacts c on c.id = op.contact_id join contact_emails ce on ce.contact_id = c.id where op.id = ${rowId}`;
      expect(contact).toEqual({ name: "Pat Doe", role: "Executive Director", email: "director@louisvillecm.org", inProject: true });

      // The prospector's view of the list rows: full notes, filters.
      await rows({
        projectId,
        rows: [
          {
            organization: "Old Festival",
            source: "owner_list",
            reason: "2019.",
            section: "Listas · 4 antiguos (2016-2019)",
            notes: "Contacto antiguo: x@old.org",
          },
        ],
      });
      const list = async (q: string) =>
        (await rowsListRoute(new Request(`${URL_BASE}/rows?projectId=${projectId}${q}`, { headers: { authorization: `Bearer ${TOKEN}` } }))).json();
      const lists = await list("&section=Listas");
      expect(lists.total).toBe(2);
      expect(lists.rows.map((r: { organization: string }) => r.organization)).toEqual(["Louisville Chamber Music", "Old Festival"]);
      expect((await list("&section=Listas&withoutContact=1")).rows).toEqual([
        expect.objectContaining({ organization: "Old Festival", contact: null, notes: expect.stringContaining("x@old.org") }),
      ]);
      expect((await list("&unresearched=1")).total).toBe(2); // Louisville (card not filled yet) and Old Festival (no contact)
    });

    it("stops new emails at the daily limit (all campaigns together)", async () => {
      const { projectId, ids } = await seed(3);
      await sql`insert into app_settings (key, value) values ('assistant', '{"dailyEmails": 2}') on conflict (key) do update set value = excluded.value`;
      const ctx = await (await get()).json();
      expect(ctx.limits.dailyEmails).toEqual({ limit: 2, used: 0, left: 2 });
      const body = await (await post({ projectId, emails: ids.map((id, i) => email(id, i)) })).json();
      expect(body.created.emails).toHaveLength(2);
      expect(body.skipped[0].reason).toMatch(/Daily limit/);
      expect((await (await get()).json()).limits.dailyEmails).toEqual({ limit: 2, used: 2, left: 0 });
    });

    it("caps new emails at 10 per campaign per call", async () => {
      const { projectId, ids } = await seed(12);
      await sql`insert into app_settings (key, value) values ('assistant', '{"dailyEmails": 50}') on conflict (key) do update set value = excluded.value`;
      const body = await (await post({ projectId, emails: ids.map((id, i) => email(id, i)) })).json();
      expect(body.created.emails).toHaveLength(10);
      expect(body.skipped.filter((s: { reason: string }) => /Limit of 10/.test(s.reason))).toHaveLength(2);
      expect(state.sent).toHaveLength(0);
    });

    it("rejects rows of another campaign", async () => {
      const { projectId } = await seed(1);
      const other = await createSheet({ name: "Other" });
      const foreign = await addSheetRow({ projectId: other, organization: "Elsewhere", email: "a@elsewhere.org" });
      const body = await (await post({ projectId, emails: [email(foreign)] })).json();
      expect(body.created.emails).toHaveLength(0);
      expect(body.skipped[0].reason).toMatch(/Not a row/);
    });

    it("revision flow: request changes → new version → waiting for approval again", async () => {
      const { projectId, ids } = await seed(1);
      const { created } = await (await post({ projectId, emails: [email(ids[0])] })).json();
      const draftId = created.emails[0].draftId;

      // Not waiting for changes yet → skipped.
      const early = await (await post({ projectId, revisions: [{ draftId, subject: "New", body: "New body" }] })).json();
      expect(early.created.revisions).toHaveLength(0);

      await requestDraftChanges(draftId, "Shorter, mention the October dates");
      expect(await getDraft(draftId)).toMatchObject({ status: "changes_requested", revisionRequest: "Shorter, mention the October dates" });
      const ctx = await (await get()).json();
      expect(ctx.projects[0].changesRequested[0]).toMatchObject({
        draftId,
        revisionRequest: "Shorter, mention the October dates",
        subject: "Autumn dates 0",
      });
      expect(await listAssistantDrafts({ projectId })).toHaveLength(0);

      const res = await (await post({ projectId, revisions: [{ draftId, subject: "October dates", body: "Short version" }] })).json();
      expect(res.created.revisions).toEqual([{ draftId }]);
      const draft = await getDraft(draftId);
      expect(draft).toMatchObject({ status: "proposed", revisionRequest: null, subject: "October dates", body: "Short version" });
      expect(draft!.revisions.at(-1)).toMatchObject({ note: "Shorter, mention the October dates", subject: "Autumn dates 0" });
      expect([...state.drafts.values()].at(-1)).toMatchObject({ subject: "October dates" });
      expect(state.sent).toHaveLength(0);
    });

    it("postponed drafts and actions come back on their day", async () => {
      const { projectId, ids } = await seed(1);
      const { created } = await (
        await post({ projectId, emails: [email(ids[0])], actions: [{ kind: "task", title: "Update the tech rider" }] })
      ).json();
      const draftId = created.emails[0].draftId;
      await postponeDraft(draftId, "2099-01-01");
      expect(await listAssistantDrafts({ projectId })).toHaveLength(0);
      expect((await listAssistantActions({ projectId, statuses: ["postponed"] })).map((a) => a.kind)).toEqual(["email"]);
      await releasePostponed("2099-01-01");
      expect((await listAssistantDrafts({ projectId })).map((d) => d.draft.id)).toEqual([draftId]);
      expect(await listAssistantActions({ projectId, statuses: ["postponed"] })).toHaveLength(0);
    });
  });
});
