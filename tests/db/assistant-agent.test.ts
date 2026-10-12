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
import { listAssistantRuns } from "@/lib/assistant/runs";
import { postponeDraft, requestDraftChanges } from "@/lib/assistant/drafts";
import { addSheetRow, createSheet } from "@/lib/queries/booking";
import { getDraft } from "@/lib/queries/drafts";
import { listAssistantActions, listAssistantDrafts, releasePostponed } from "@/lib/queries/assistant";
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
      ids.push(await addSheetRow({ projectId, organization: `Venue ${i}`, email: `booker${i}@venue${i}.org`, contactName: `Booker ${i}`, phone: "+34600000000" }));
    }
    if (cards) await fillCards();
    return { projectId, ids };
  }

  const email = (opportunityId: string, n = 0) => ({ opportunityId, subject: `Autumn dates ${n}`, body: `Hello ${n}`, reason: "No reply in 12 days", priority: 1 });

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
      const res = await post({ projectId, emails: [email(ids[0]), email(ids[1], 1)], actions: [{ opportunityId: ids[0], kind: "whatsapp", title: "WhatsApp Booker 0" }] });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.created.emails).toHaveLength(2);
      expect(body.created.actions).toHaveLength(1);
      const draft = await getDraft(body.created.emails[0].draftId);
      expect(draft).toMatchObject({ status: "proposed", origin: "assistant", assistantReason: "No reply in 12 days", to: ["booker0@venue0.org"] });
      expect(state.sent).toHaveLength(0);

      // Second run: same rows → skipped (open), duplicate action skipped too.
      const again = await (await post({ projectId, emails: [email(ids[0])], actions: [{ opportunityId: ids[0], kind: "whatsapp", title: "Again" }] })).json();
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
      const contacts = (path = "") => contactsRoute(new Request(`${URL_BASE}/contacts?projectId=${projectId}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } }));
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
          revisions: [{ draftId, subject: "Re: Collaboration - ADAR 2027", body: "A concrete idea", noteToOwner: "Checked their season: they program dance — and music." }],
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
      await add(me, "g1", "me@example.com", ["booker0@venue0.org", "a@x.org", "b@x.org", "c@x.org", "d@x.org", "e@x.org"], "Newsletter", "2025-06-01T10:00:00Z");
      await add(me, "g2", "booker0@venue0.org", ["me@example.com"], "Re: Season 2025", "2025-01-12T10:00:00Z");
      const [{ contactId }] = await sql<{ contactId: string }[]>`select contact_id from contact_emails where email = 'booker0@venue0.org'`;
      const res = await historyRoute(new Request(`${URL_BASE}/history?contactId=${contactId}`, { headers: { authorization: `Bearer ${TOKEN}` } }));
      const body = await res.json();
      expect(body.messages.map((m: { subject: string }) => m.subject)).toEqual(["Newsletter", "Re: Season 2025", "Season 2025"]);
      expect(body.messages[0]).toMatchObject({ bulk: true, recipients: 6, to: ["(mass email to 6 people)"] });
      expect(body.messages[2]).toMatchObject({ mailbox: "josefina@example.com", direction: "outbound", body: "Body of Season 2025" });
      expect((await historyRoute(new Request(`${URL_BASE}/history`, { headers: { authorization: `Bearer ${TOKEN}` } }))).status).toBe(400);
    });

    it("caps new emails at 10 per campaign per call", async () => {
      const { projectId, ids } = await seed(12);
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
      expect(ctx.projects[0].changesRequested[0]).toMatchObject({ draftId, revisionRequest: "Shorter, mention the October dates", subject: "Autumn dates 0" });
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
      const { created } = await (await post({ projectId, emails: [email(ids[0])], actions: [{ kind: "task", title: "Update the tech rider" }] })).json();
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
