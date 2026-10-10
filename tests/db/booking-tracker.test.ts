import { beforeEach, describe, expect, it, vi } from "vitest";

/* Gmail drafts are mocked: nothing ever leaves the test (see approvals.test.ts). */
const state = vi.hoisted(() => ({
  drafts: new Map<string, { to: string[]; subject: string; body: string; replyToMessageId: string | null }>(),
  sent: [] as unknown[],
  next: 0,
}));

vi.mock("@/lib/sync/drafts", async () => {
  class DraftError extends Error {}
  return {
    DraftError,
    saveGmailDraft: vi.fn(async (p: { to: string[]; subject: string; body: string; replyToMessageId?: string | null }) => {
      const id = `d${++state.next}`;
      state.drafts.set(id, { to: p.to, subject: p.subject, body: p.body, replyToMessageId: p.replyToMessageId ?? null });
      return { draftId: id, gmailUrl: "https://mail.google.com/" };
    }),
    updateGmailDraft: vi.fn(async () => {
      throw new Error("not expected");
    }),
    sendGmailDraft: vi.fn(async (...args: unknown[]) => {
      state.sent.push(args);
      throw new Error("Nothing may be sent from a booking sheet");
    }),
    deleteGmailDraft: vi.fn(async (_a: string, id: string) => void state.drafts.delete(id)),
  };
});

vi.mock("@/lib/auth", () => ({
  assertSession: async () => undefined,
  requireSession: async () => undefined,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

import { sql } from "@/lib/db";
import { GET as exportSheet } from "@/app/(app)/campaigns/[id]/export/route";
import { suggestTemplate } from "@/lib/booking/templates";
import { proposeEmail } from "@/lib/ai/approvals";
import { addActivity, deleteActivity, listActivities, logCall, timelineForContact, timelineForRow } from "@/lib/queries/activities";
import {
  addSheetRow,
  advanceSheetStages,
  bulkUpdateSheetRows,
  createSheet,
  getSheet,
  getSheetRows,
  importSheetRows,
  listSheets,
  listSendAccounts,
  updateSheetRow,
  updateSheetSettings,
} from "@/lib/queries/booking";
import { prepareSheetEmails } from "@/lib/queries/booking-emails";
import { createContact, deleteContact, getContact, listContacts, mergeContacts, updateContact } from "@/lib/queries/contacts";
import { countPendingDrafts, listDrafts } from "@/lib/queries/drafts";
import { listOpportunities } from "@/lib/queries/opportunities";
import { addStarterTemplates, copyTemplates, createTemplate, deleteTemplate, listTemplates, updateTemplate } from "@/lib/queries/templates";
import { insertAccount, useTestDatabase } from "../setup/db";

async function insertMessage(m: {
  accountId: string;
  id: string;
  thread?: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string[];
  subject: string;
  sentAt: Date;
}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into messages (account_id, gmail_message_id, gmail_thread_id, rfc822_message_id, direction, from_email, subject, snippet, sent_at)
    values (${m.accountId}, ${m.id}, ${m.thread ?? `t-${m.id}`}, ${`<${m.id}@test>`}, ${m.direction}, ${m.from}, ${m.subject}, ${m.subject}, ${m.sentAt})
    returning id
  `;
  await sql`insert into message_participants (message_id, role, email) values (${row.id}, 'from', ${m.from})`;
  for (const email of m.to) await sql`insert into message_participants (message_id, role, email) values (${row.id}, 'to', ${email})`;
  await sql`
    select refresh_contact_stats(array(
      select distinct ce.contact_id from contact_emails ce where ce.email = any(${[m.from, ...m.to]}::text[])))`;
  return row.id;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Pretend the sheet's rows were added `n` days ago (so later mail and calls count as "after"). */
async function backdateRows(projectId: string, n: number) {
  await sql`update opportunities set created_at = now() - make_interval(days => ${n}) where project_id = ${projectId}`;
}

async function statusEntries(rowId: string): Promise<string[]> {
  const rows = await sql<{ body: string }[]>`
    select body from activities where opportunity_id = ${rowId} and kind = 'status' order by occurred_at, created_at`;
  return rows.map((r) => r.body);
}

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("booking tracker", () => {
  useTestDatabase();

  beforeEach(() => {
    state.drafts.clear();
    state.sent.length = 0;
    state.next = 0;
  });

  it("migrates the new columns and tables", async () => {
    const columns = await sql<{ table: string; column: string }[]>`
      select table_name as table, column_name as column from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (
           ('contacts', 'phone'), ('contacts', 'whatsapp'), ('opportunities', 'sheet_section'), ('opportunities', 'spaces'),
           ('opportunities', 'is_returning'), ('projects', 'phone_prefix'), ('projects', 'send_account_id'),
           ('activities', 'outcome'), ('email_templates', 'trigger'))
    `;
    expect(columns).toHaveLength(9);
    const [{ rls }] = await sql<{ rls: boolean }[]>`
      select bool_and(relrowsecurity) as rls from pg_class where relname in ('activities', 'email_templates')`;
    expect(rls).toBe(true);
    // Only normalized numbers can be stored.
    await expect(sql`insert into contacts (name, phone) values ('X', 'tel:612')`).rejects.toThrow();
    await expect(sql`insert into activities (kind, body) values ('note', 'nowhere')`).rejects.toThrow();
    await expect(sql`insert into activities (kind, outcome, body) values ('note', 'reached', 'x')`).rejects.toThrow();
  });

  it("adds rows with phone-only contacts, normalizing with the sheet's prefix", async () => {
    const sheet = await createSheet({ name: "Festival ADAR · concejos", currency: "EUR", phonePrefix: "34" });
    expect((await getSheet(sheet))?.phonePrefix).toBe("+34");
    const a = await addSheetRow({
      projectId: sheet,
      organization: "Ayuntamiento de Colunga",
      phone: "985 85 60 01",
      section: "Cultura en Rede",
      spaces: "Casa de Cultura",
      returning: true,
      fee: "1.200",
    });
    const [row] = await getSheetRows(sheet);
    expect(row).toMatchObject({
      id: a,
      section: "Cultura en Rede",
      spaces: "Casa de Cultura",
      returning: true,
      value: "1200.00",
      contact: { name: null, displayName: "Unknown", email: null, phone: "+34985856001", whatsapp: null },
      lastActivity: null,
      lastCall: null,
      activityCount: 0,
    });
    expect(typeof row.createdAt).toBe("string");

    // Same name in the same organization → same contact; its empty WhatsApp is filled.
    await addSheetRow({ projectId: sheet, organization: "Teatro Riera", contactName: "Elena Díaz", phone: "612345678" });
    await addSheetRow({ projectId: sheet, organization: "teatro riera", contactName: "elena díaz", whatsapp: "+34 699 11 12 22", section: "cultura EN rede" });
    const contacts = await sql<{ name: string; phone: string; whatsapp: string }[]>`select name, phone, whatsapp from contacts where name ilike 'elena%'`;
    expect(contacts).toEqual([{ name: "Elena Díaz", phone: "+34612345678", whatsapp: "+34699111222" }]);
    const sections = await sql<{ s: string }[]>`select distinct sheet_section as s from opportunities where sheet_section is not null`;
    expect(sections.map((x) => x.s)).toEqual(["Cultura en Rede"]); // the sheet's spelling is kept

    // An existing contact found by email gets the phone.
    await createContact({ name: "Ana", emails: ["ana@campoamor.es"] });
    await addSheetRow({ projectId: sheet, organization: "Teatro Campoamor", email: "ANA@campoamor.es", phone: "+33 6 12 34 56 78" });
    expect((await getContact((await sql<{ id: string }[]>`select id from contacts where name = 'Ana'`)[0].id))?.phone).toBe("+33612345678");

    await expect(addSheetRow({ projectId: sheet, organization: "X", phone: "call me" })).rejects.toThrow(/Invalid phone/);
    await expect(addSheetRow({ projectId: sheet, organization: "X", fee: "a convenir" })).rejects.toThrow(/Fee/);

    // Global search finds the phone by its digits.
    expect((await listContacts({ q: "699 11 12" })).contacts.map((c) => c.name)).toEqual(["Elena Díaz"]);
    expect((await listContacts({ q: "6123" })).contacts.map((c) => c.name).sort()).toEqual(["Ana", "Elena Díaz"]);
  });

  it("logs activities and counts calls only when someone answered", async () => {
    const contactId = await createContact({ name: "Marta", emails: [] });
    await updateContact(contactId, { phone: "612 34 56 78", whatsapp: "+34 699 000 111" });
    expect(await getContact(contactId)).toMatchObject({ phone: "612345678", whatsapp: "+34699000111" });
    await expect(updateContact(contactId, { phone: "tel:x" })).rejects.toThrow(/Invalid phone/);
    const at = (iso: string) => new Date(iso);
    await logCall({ contactId, outcome: "reached", body: "Interested", occurredAt: at("2026-09-10T10:00:00Z") });
    expect((await getContact(contactId))?.lastContactedAt?.toISOString()).toBe("2026-09-10T10:00:00.000Z");

    const noAnswer = await logCall({ contactId, outcome: "no_answer", occurredAt: at("2026-09-12T10:00:00Z"), followUpAt: "2026-09-14", nextStep: "Call again" });
    expect((await getContact(contactId))?.lastContactedAt?.toISOString()).toBe("2026-09-10T10:00:00.000Z");
    expect(await getContact(contactId)).toMatchObject({ followUpAt: "2026-09-14", followUpNote: "Call again" });
    await addActivity({ kind: "note", contactId, body: "Prefers mornings", occurredAt: at("2026-09-13T10:00:00Z") });
    expect((await getContact(contactId))?.lastContactedAt?.toISOString()).toBe("2026-09-10T10:00:00.000Z");

    const wa = await addActivity({ kind: "whatsapp", contactId, outcome: "reached", occurredAt: at("2026-09-15T10:00:00Z") });
    expect(wa.activity.outcome).toBeNull(); // outcomes are for calls
    expect((await getContact(contactId))?.lastContactedAt?.toISOString()).toBe("2026-09-15T10:00:00.000Z");

    expect((await listActivities({ contactId })).map((a) => a.kind)).toEqual(["whatsapp", "note", "call", "call"]);
    // Paging along the contact's history: only entries older than `before`.
    expect((await listActivities({ contactId, before: at("2026-09-13T10:00:00Z") })).map((a) => a.outcome)).toEqual(["no_answer", "reached"]);
    expect(await deleteActivity(wa.activity.id)).toBe(true);
    expect(await deleteActivity(wa.activity.id)).toBe(false);
    expect((await getContact(contactId))?.lastContactedAt?.toISOString()).toBe("2026-09-10T10:00:00.000Z");
    expect(noAnswer.activity).toMatchObject({ kind: "call", outcome: "no_answer", contactId });

    // Email still counts: the latest of both.
    const account = await insertAccount("me@own.test", { status: "active" });
    await addContactEmailFor(contactId, "marta@venue.es");
    await insertMessage({ accountId: account, id: "m1", direction: "inbound", from: "marta@venue.es", to: ["me@own.test"], subject: "Hola", sentAt: at("2026-09-20T10:00:00Z") });
    expect((await getContact(contactId))?.lastContactedAt?.toISOString()).toBe("2026-09-20T10:00:00.000Z");

    // Merging moves activities; deleting the contact drops the ones that belonged only to it.
    await updateContact(contactId, { whatsapp: null });
    const other = await createContact({ name: "Marta (2)", emails: [], phone: "+34600000002", whatsapp: "+34600000001" });
    await addActivity({ kind: "note", contactId: other, body: "From the duplicate" });
    await mergeContacts(contactId, other);
    expect((await listActivities({ contactId })).some((a) => a.body === "From the duplicate")).toBe(true);
    expect(await getContact(contactId)).toMatchObject({ phone: "612345678", whatsapp: "+34600000001" }); // empty fields filled
    await deleteContact(contactId);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from activities`;
    expect(n).toBe(0);
  });

  it("moves rows to Contacted after an email or a call, with a status entry", async () => {
    const account = await insertAccount("me@own.test", { status: "active" });
    const sheet = await createSheet({ name: "Gira 2027", phonePrefix: "+34" });
    const emailed = await addSheetRow({ projectId: sheet, organization: "Sala A", contactName: "Ana", email: "ana@a.es" });
    const called = await addSheetRow({ projectId: sheet, organization: "Sala B", contactName: "Bea", phone: "612000111" });
    const untouched = await addSheetRow({ projectId: sheet, organization: "Sala C", contactName: "Cris", email: "cris@c.es" });
    await backdateRows(sheet, 3);

    await insertMessage({ accountId: account, id: "m1", direction: "outbound", from: "me@own.test", to: ["ana@a.es"], subject: "Propuesta", sentAt: daysAgo(2) });
    // A call logged on the contact (e.g. from the contact page), not on the row.
    const [{ contactId }] = await sql<{ contactId: string }[]>`select contact_id from opportunities where id = ${called}`;
    await logCall({ contactId, outcome: "no_answer", occurredAt: daysAgo(1) });
    // Mail and notes from before the row existed do not count.
    await insertMessage({ accountId: account, id: "m0", direction: "outbound", from: "me@own.test", to: ["cris@c.es"], subject: "Old", sentAt: daysAgo(30) });

    expect(await advanceSheetStages(sheet)).toBe(2);
    expect(await advanceSheetStages(sheet)).toBe(0);
    expect(await advanceSheetStages()).toBe(0);
    const rows = new Map((await getSheetRows(sheet)).map((r) => [r.id, r]));
    expect(rows.get(emailed)?.stage).toBe("contacted");
    expect(rows.get(called)?.stage).toBe("contacted");
    expect(rows.get(untouched)?.stage).toBe("lead");
    expect(await statusEntries(emailed)).toEqual(["To contact → Contacted (email sent)"]);
    expect(await statusEntries(called)).toEqual(["To contact → Contacted (call)"]);
    expect(rows.get(called)).toMatchObject({ lastCall: { outcome: "no_answer" }, lastActivity: { kind: "call" }, activityCount: 1 });

    // Logging on the row itself moves it right away; a note does not.
    expect((await addActivity({ kind: "note", opportunityId: untouched, body: "Try in October" })).stageChanged).toBeNull();
    const logged = await addActivity({ kind: "whatsapp", opportunityId: untouched, body: "Sent the dossier", followUpAt: "2026-10-08", nextStep: "Ask for dates" });
    expect(logged.stageChanged).toBe("contacted");
    expect(logged.activity).toMatchObject({ opportunityId: untouched, organizationId: expect.any(String), contactId: expect.any(String) });
    expect(await statusEntries(untouched)).toEqual(["To contact → Contacted (WhatsApp)"]);
    const [c] = await getSheetRows(sheet, { ids: [untouched] });
    expect(c).toMatchObject({ stage: "contacted", followUpAt: "2026-10-08", nextStep: "Ask for dates", lastActivity: { kind: "whatsapp", body: "Sent the dossier" } });

    const sheetView = await getSheet(sheet);
    expect(sheetView?.counts).toEqual({ toContact: 0, contacted: 3, proposal: 0, inConversation: 0, confirmed: 0, declined: 0 });
    // Cris never answered the old email (30 days): waiting on them for more than 10 days.
    expect(sheetView?.noReply).toBe(1);

    // Put back to "To contact" by hand, a row stays there until a new email or call.
    await updateSheetRow(emailed, { stage: "lead" });
    expect(await advanceSheetStages(sheet)).toBe(0);
    expect((await getSheetRows(sheet, { ids: [emailed] }))[0].stage).toBe("lead");
    await logCall({ opportunityId: emailed, outcome: "reached" });
    expect((await getSheetRows(sheet, { ids: [emailed] }))[0].stage).toBe("contacted");
  });

  it("logs status changes and edits the new fields", async () => {
    const sheet = await createSheet({ name: "Booking USA", phonePrefix: "+1" });
    const row = await addSheetRow({ projectId: sheet, organization: "Fontana", contactName: "Sophie", email: "sophie@fontana.org", section: "Internacional" });
    await updateSheetRow(row, { stage: "negotiation", fee: "4,500", returning: true, spaces: "Hall A", phone: "(206) 555-0100", whatsapp: "" });
    await updateSheetRow(row, { stage: "negotiation", notes: "Same stage: no entry" });
    await updateSheetRow(row, { stage: "won" });
    await updateSheetRow(row, { section: "internacional", nextStep: "  Send contract " });
    expect(await statusEntries(row)).toEqual(["To contact → In conversation", "In conversation → Confirmed"]);
    const [r] = await getSheetRows(sheet);
    expect(r).toMatchObject({
      stage: "won",
      value: "4500.00",
      returning: true,
      spaces: "Hall A",
      section: "Internacional",
      nextStep: "Send contract",
      notes: "Same stage: no entry",
      contact: { phone: "+12065550100", whatsapp: null },
      activityCount: 0,
    });
    const [{ closedAt }] = await sql<{ closedAt: Date | null }[]>`select closed_at from opportunities where id = ${row}`;
    expect(closedAt).not.toBeNull();
    await expect(updateSheetRow(row, { phone: "nope" })).rejects.toThrow(/Invalid phone/);
    await expect(updateSheetRow(row, { fee: "TBD" })).rejects.toThrow(/Fee/);

    // A phone on a row without a contact creates one.
    const bare = await addSheetRow({ projectId: sheet, organization: "Lincoln Center" });
    await updateSheetRow(bare, { phone: "212 555 0100" });
    const [withPhone] = await getSheetRows(sheet, { ids: [bare] });
    expect(withPhone.contact).toMatchObject({ displayName: "Unknown", phone: "+12125550100" });

    expect(await bulkUpdateSheetRows(sheet, [row, bare], { section: "USA" })).toBe(2);
    expect(await bulkUpdateSheetRows(sheet, [bare], { stage: "lost" })).toBe(1);
    expect(await statusEntries(bare)).toEqual(["To contact → Declined"]);
    expect((await getSheetRows(sheet)).map((x) => x.section)).toEqual(["USA", "USA"]);

    const [listed] = await listSheets("2026-10-01");
    expect(listed).toMatchObject({ rows: 2, confirmed: 1, declined: 1, phonePrefix: "+1", counts: { confirmed: 1, declined: 1 } });

    // Pipeline cards see the phone on the deal's contact.
    const deals = await listOpportunities({ includeClosed: true });
    expect(deals.find((d) => d.id === row)?.contact).toMatchObject({ phone: "+12065550100", whatsapp: null });

    // The timeline merges activities and emails.
    const account = await insertAccount("me@own.test", { status: "active" });
    await insertMessage({ accountId: account, id: "g1", thread: "thr1", direction: "outbound", from: "me@own.test", to: ["sophie@fontana.org"], subject: "Contract", sentAt: new Date() });
    const timeline = await timelineForRow(row);
    expect(timeline?.items[0]).toMatchObject({ type: "email", direction: "outbound", subject: "Contract", href: `/mail/t/${account}/thr1` });
    expect(timeline?.items.filter((i) => i.type === "activity").map((i) => i.type === "activity" && i.body)).toEqual([
      "In conversation → Confirmed",
      "To contact → In conversation",
    ]);
    expect((await timelineForContact(r.contact!.id))?.items).toHaveLength(3);
  });

  it("flags rows waiting on an answer for more than 10 days", async () => {
    const account = await insertAccount("me@own.test", { status: "active" });
    const sheet = await createSheet({ name: "Waiting" });
    const row = await addSheetRow({ projectId: sheet, organization: "Sala", email: "x@sala.es", stage: "contacted" });
    await backdateRows(sheet, 30);
    await insertMessage({ accountId: account, id: "w1", direction: "outbound", from: "me@own.test", to: ["x@sala.es"], subject: "Hola", sentAt: daysAgo(12) });
    const sheetView = await getSheet(sheet);
    expect(sheetView).toMatchObject({ noReply: 1, counts: { contacted: 1 } });
    await updateSheetRow(row, { stage: "negotiation" });
    expect((await getSheet(sheet))?.noReply).toBe(0);
  });

  it("prepares emails into Approvals from templates and never sends", async () => {
    const account = await insertAccount("me@own.test", { status: "active" });
    await insertAccount("old@own.test", { status: "disconnected" });
    expect((await listSendAccounts()).map((a) => a.email)).toEqual(["me@own.test"]);
    await sql`insert into app_settings (key, value) values ('profile', ${sql.json({ name: "Guillermo", signature: "Guillermo · ADAR", style: "" })})`;
    const sheet = await createSheet({ name: "Festival ADAR 2026", currency: "EUR" });
    expect(await addStarterTemplates(sheet)).toBe(9);
    expect(await addStarterTemplates(sheet)).toBe(0);

    const lead = await addSheetRow({ projectId: sheet, organization: "Valdediós", contactName: "Sra. Ana López", email: "ana@valdedios.es" });
    const noEmail = await addSheetRow({ projectId: sheet, organization: "Colunga", phone: "985856001" });
    const waiting = await addSheetRow({ projectId: sheet, organization: "Llanes", contactName: "Luis", email: "luis@llanes.es", stage: "contacted" });
    const busy = await addSheetRow({ projectId: sheet, organization: "Gijón", contactName: "Gema", email: "gema@gijon.es" });
    const confirmed = await addSheetRow({ projectId: sheet, organization: "Avilés", contactName: "Aurora", email: "aurora@aviles.es", stage: "won" });
    await backdateRows(sheet, 20);
    const first = await insertMessage({ accountId: account, id: "p1", thread: "th-llanes", direction: "outbound", from: "me@own.test", to: ["luis@llanes.es"], subject: "Propuesta Festival ADAR", sentAt: daysAgo(7) });
    const [{ contactId: gema }] = await sql<{ contactId: string }[]>`select contact_id from opportunities where id = ${busy}`;
    await proposeEmail({ accountId: account, contactId: gema, to: ["gema@gijon.es"], subject: "Hi", body: "Hi", origin: "owner" });
    const confirmedTemplate = (await listTemplates(sheet)).find((t) => t.trigger === "confirmed")!;
    await deleteTemplate(confirmedTemplate.id);

    const result = await prepareSheetEmails({ projectId: sheet, rowIds: [lead, noEmail, waiting, busy, confirmed] });
    expect(result.skipped).toEqual([
      { rowId: noEmail, reason: "No email address" },
      { rowId: busy, reason: "Already in Approvals" },
      { rowId: confirmed, reason: "No template for this status" },
    ]);
    expect(result.prepared.map((p) => [p.rowId, p.templateName])).toEqual([
      [lead, "Propuesta"],
      [waiting, "Follow-up"],
    ]);
    // Two emails prepared together: a campaign waiting for approval, nothing queued.
    expect(result.campaignId).toEqual(expect.any(String));
    const [campaign] = await sql<{ name: string; status: string; accountId: string; projectId: string }[]>`
      select name, status, account_id, project_id from email_campaigns where id = ${result.campaignId}`;
    expect(campaign).toMatchObject({ status: "draft", accountId: account, projectId: sheet });
    expect(campaign.name).toMatch(/^Festival ADAR 2026 · Suggested templates · [A-Z][a-z]{2} \d{1,2}$/);
    const linked = await sql<{ status: string }[]>`select status from email_drafts where campaign_id = ${result.campaignId}`;
    expect(linked.map((d) => d.status)).toEqual(["proposed", "proposed"]);
    // Approvals lists the standalone proposal; the campaign counts as one item.
    expect((await listDrafts()).map((d) => d.contact?.id)).toEqual([gema]);
    expect(await countPendingDrafts()).toBe(2);

    const drafts = await sql<
      { opportunityId: string; origin: string; purpose: string; subject: string; bodyText: string; rationale: string; replyToMessageId: string | null; status: string }[]
    >`select opportunity_id, origin, purpose, subject, body_text, rationale, reply_to_message_id, status
        from email_drafts where opportunity_id is not null order by created_at`;
    expect(drafts[0]).toMatchObject({
      opportunityId: lead,
      origin: "owner",
      purpose: "outreach",
      subject: "Propuesta de colaboración — Valdediós",
      rationale: 'Campaign "Festival ADAR 2026" · template "Propuesta"',
      replyToMessageId: null,
      status: "proposed",
    });
    expect(drafts[0].bodyText).toMatch(/^Buenos días Ana:/);
    expect(drafts[0].bodyText).toMatch(/Guillermo · ADAR$/);
    // The follow-up replies in the unanswered thread.
    expect(drafts[1]).toMatchObject({ opportunityId: waiting, purpose: "follow_up", subject: "Re: Propuesta Festival ADAR", replyToMessageId: first });
    expect(state.drafts.size).toBe(3); // two prepared + the one made above
    expect(state.sent).toEqual([]);
    // The sheet knows which contacts have an email waiting (its button opens the draft).
    const byId = new Map((await getSheetRows(sheet)).map((r) => [r.id, r.contact?.openDraftId ?? null]));
    const [leadDraft] = await sql<{ id: string }[]>`select id from email_drafts where opportunity_id = ${lead}`;
    expect(byId.get(lead)).toBe(leadDraft.id);
    expect(byId.get(busy)).not.toBeNull();
    expect(byId.get(confirmed)).toBeNull();

    // Again: both are waiting in Approvals now. A chosen template applies to every row.
    const again = await prepareSheetEmails({ projectId: sheet, rowIds: [lead, confirmed], templateId: (await listTemplates(sheet))[0].id });
    expect(again.skipped).toEqual([{ rowId: lead, reason: "Already in Approvals" }]);
    expect(again.prepared.map((p) => p.rowId)).toEqual([confirmed]);
    expect(again.campaignId).toBeNull(); // one email: a normal proposal
    await expect(prepareSheetEmails({ projectId: sheet, rowIds: Array.from({ length: 101 }, () => crypto.randomUUID()) })).rejects.toThrow(/100/);
    expect(state.sent).toEqual([]);
  });

  it("imports rows, skipping bad ones and duplicates", async () => {
    const sheet = await createSheet({ name: "Import", phonePrefix: "+34" });
    await addSheetRow({ projectId: sheet, organization: "Teatro Riera", email: "riera@x.es" });
    const text = [
      "Municipio;Contacto;Correo;Teléfono;Sección;Estado;Previo",
      "Valdediós;Ana López;ana@valdedios.es;985 89 17 50;Cultura en Rede;Email enviado;sí",
      ";Nadie;nadie@x.es;;;;",
      "Llanes;Luis;;1234567890123456;;;",
      "Teatro Riera;;riera@x.es;;;;",
      "Colunga;;;600 111 222;Cultura en Rede;;",
    ].join("\n");
    const result = await importSheetRows(sheet, text);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(3);
    expect(result.errors).toEqual([
      { line: 3, message: "No organization name." },
      { line: 4, message: "Llanes: Invalid phone number: 1234567890123456" },
      { line: 5, message: "Teatro Riera: already in this campaign." },
    ]);
    const rows = await getSheetRows(sheet);
    expect(rows.find((r) => r.title === "Valdediós")).toMatchObject({
      stage: "contacted",
      returning: true,
      section: "Cultura en Rede",
      contact: { name: "Ana López", email: "ana@valdedios.es", phone: "+34985891750" },
    });
    expect(rows.find((r) => r.title === "Colunga")?.contact).toMatchObject({ phone: "+34600111222", name: null });
  });

  it("manages templates and suggests them for rows", async () => {
    const sheet = await createSheet({ name: "Templates A" });
    const other = await createSheet({ name: "Templates B" });
    const global = await createTemplate({ projectId: null, name: "Generic first", trigger: "first_contact", subject: "Hello {{venue}}", body: "Hi {{first_name}}" });
    const own = await createTemplate({ projectId: sheet, name: "Our first", trigger: "first_contact", subject: "Hola {{venue}}", body: "Hola {{first_name}}\r\n\r\n" });
    await createTemplate({ projectId: sheet, name: "Nudge", trigger: "follow_up", subject: "Re", body: "?" });
    await createTemplate({ projectId: other, name: "Nudge", trigger: "follow_up", subject: "Existing", body: "!" });

    const list = await listTemplates(sheet);
    expect(list.map((t) => t.name)).toEqual(["Our first", "Nudge", "Generic first"]);
    expect(list[0]).toMatchObject({ id: own, projectId: sheet, sortOrder: 1, body: "Hola {{first_name}}" });
    expect((await listTemplates(null)).map((t) => t.id)).toEqual([global]);

    const row = await addSheetRow({ projectId: sheet, organization: "Sala", contactName: "Ana", email: "ana@sala.es" });
    const [r] = await getSheetRows(sheet);
    expect(r.id).toBe(row);
    expect(suggestTemplate(r, list)?.id).toBe(own);
    await updateTemplate(own, { trigger: "custom", name: "Manual one" });
    expect(suggestTemplate(r, await listTemplates(sheet))?.id).toBe(global);
    await expect(updateTemplate(own, { name: " " })).rejects.toThrow(/name/);

    expect(await copyTemplates(sheet, other)).toBe(1); // "Nudge" exists there already
    expect((await listTemplates(other)).map((t) => t.name)).toEqual(["Nudge", "Manual one", "Generic first"]);
    await deleteTemplate(own);
    expect((await listTemplates(sheet)).map((t) => t.name)).toEqual(["Nudge", "Generic first"]);

    // Deleting a sheet deletes its templates, never the global ones.
    await sql`delete from projects where id = ${sheet}`;
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from email_templates`;
    expect(n).toBe(3);
  });

  it("saves sheet settings", async () => {
    const account = await insertAccount("me@own.test", { status: "active" });
    const sheet = await createSheet({ name: "Settings" });
    await updateSheetSettings(sheet, { name: "Settings 2", currency: "eur", phonePrefix: "0034", sendAccountId: account, description: "Spain" });
    expect(await getSheet(sheet)).toMatchObject({ name: "Settings 2", currency: "EUR", phonePrefix: "+34", sendAccountId: account, description: "Spain" });
    await updateSheetSettings(sheet, { phonePrefix: "", sendAccountId: null });
    expect(await getSheet(sheet)).toMatchObject({ phonePrefix: null, sendAccountId: null });
    await expect(updateSheetSettings(sheet, { phonePrefix: "Spain" })).rejects.toThrow(/country code/);
    await expect(updateSheetSettings(sheet, { currency: "euro" })).rejects.toThrow(/currency/);
  });

  it("exports the new columns and the history", async () => {
    const sheet = await createSheet({ name: "Export", phonePrefix: "+34" });
    const row = await addSheetRow({ projectId: sheet, organization: "Sala", contactName: "Ana", phone: "612345678", section: "Norte", spaces: "Sala 1", returning: true });
    await logCall({ opportunityId: row, outcome: "reached", body: "=cmd() interested", occurredAt: new Date("2026-09-28T10:00:00Z") });
    const response = await exportSheet(new Request("http://localhost/campaigns/x/export"), { params: Promise.resolve({ id: sheet }) } as never);
    const text = await response.text();
    const [header, line] = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toContain('"Section","City","Spaces","Returning","Contact","Role","Email","Phone","WhatsApp"');
    expect(header).toContain('"Last activity"');
    expect(header.endsWith('"History"')).toBe(true);
    expect(line).toContain(`"Norte"`);
    expect(line).toContain(`"'+34612345678"`); // formula guard
    expect(line).toContain('"2026-09-28 Call (Talked)"');
    expect(line).toContain('2026-09-28 Call (Talked): =cmd() interested | 2026-09-28 Status change: To contact → Contacted (call)');
    expect(header).toContain('"WhatsApp","Goal","Status","Last contact","Last activity","Follow up","Next action","Next step"');
    expect(line).toContain('"Get booked","Contacted"');
  });

  it("holds any goal kind per row, with a structured next step", async () => {
    const account = await insertAccount("me@own.test", { status: "active" });
    const sheet = await createSheet({ name: "Asturias", phonePrefix: "+34" });
    expect((await getSheet(sheet))?.kinds).toEqual([]);
    const booking = await addSheetRow({ projectId: sheet, organization: "Teatro Jovellanos", email: "tj@gijon.es", nextAction: "send_proposal" });
    const space = await addSheetRow({ projectId: sheet, organization: "Casa de Cultura de Llanes", kind: "venue", nextAction: "call", nextStep: "Ask for the hall", followUpAt: "2026-10-06" });
    const press = await addSheetRow({ projectId: sheet, organization: "La Nueva España", kind: "press", contactName: "Pablo", email: "pablo@lne.es" });
    await expect(addSheetRow({ projectId: sheet, organization: "X", kind: "nope" as never })).rejects.toThrow(/goal type/);
    await expect(addSheetRow({ projectId: sheet, organization: "X", nextAction: "dance" as never })).rejects.toThrow(/next step/);

    const rows = new Map((await getSheetRows(sheet)).map((r) => [r.id, r]));
    expect(rows.size).toBe(3);
    expect(rows.get(booking)).toMatchObject({ kind: "booking", nextAction: "send_proposal", nextStep: null });
    expect(rows.get(space)).toMatchObject({ kind: "venue", nextAction: "call", nextStep: "Ask for the hall", followUpAt: "2026-10-06" });
    expect(rows.get(press)?.kind).toBe("press");
    expect((await getSheet(sheet))?.kinds).toEqual(["booking", "press", "venue"]);
    // The organization's kind follows the goal when it had none.
    const orgKinds = await sql<{ name: string; kind: string }[]>`select name, kind from organizations order by name`;
    expect(orgKinds).toEqual([
      { name: "Casa de Cultura de Llanes", kind: "venue" },
      { name: "La Nueva España", kind: "press" },
      { name: "Teatro Jovellanos", kind: "venue" },
    ]);

    // Status entries are named for the row's goal.
    await updateSheetRow(space, { stage: "won" });
    await updateSheetRow(press, { kind: "press", stage: "proposal" });
    expect(await statusEntries(space)).toEqual(["To ask → Granted"]);
    expect(await statusEntries(press)).toEqual(["To pitch → Materials sent"]);
    await updateSheetRow(space, { nextAction: null, kind: "exchange" });
    expect((await getSheetRows(sheet, { ids: [space] }))[0]).toMatchObject({ kind: "exchange", nextAction: null, stage: "won" });
    expect(await bulkUpdateSheetRows(sheet, [booking, press], { nextAction: "keep_informed" })).toBe(2);
    expect((await getSheetRows(sheet, { ids: [press] }))[0].nextAction).toBe("keep_informed");

    // Contacted after an email, whatever the goal: the entry uses its stage names.
    const lead = await addSheetRow({ projectId: sheet, organization: "Fundación Valdés", kind: "fundraising", email: "info@valdes.org" });
    await backdateRows(sheet, 3);
    await insertMessage({ accountId: account, id: "f1", direction: "outbound", from: "me@own.test", to: ["info@valdes.org"], subject: "Mecenazgo", sentAt: daysAgo(1) });
    expect(await advanceSheetStages(sheet)).toBe(1);
    expect(await statusEntries(lead)).toEqual(["Prospect → Contacted (email sent)"]);

    // Logging a call can set the next step (and clear it with null).
    await logCall({ opportunityId: booking, outcome: "no_answer", nextAction: "call", followUpAt: "2026-10-07" });
    expect((await getSheetRows(sheet, { ids: [booking] }))[0]).toMatchObject({ nextAction: "call", followUpAt: "2026-10-07" });
    await addActivity({ kind: "note", opportunityId: booking, body: "x" });
    expect((await getSheetRows(sheet, { ids: [booking] }))[0].nextAction).toBe("call"); // omitted: kept
    await addActivity({ kind: "note", opportunityId: booking, body: "y", nextAction: null });
    expect((await getSheetRows(sheet, { ids: [booking] }))[0].nextAction).toBeNull();
    // Without a row, the action names the contact's follow-up.
    const loose = await createContact({ name: "Rosa", emails: [] });
    await logCall({ contactId: loose, outcome: "call_back", nextAction: "call", followUpAt: "2026-10-09" });
    expect(await getContact(loose)).toMatchObject({ followUpAt: "2026-10-09", followUpNote: "Call" });

    // Pipeline cards and Today see the next step.
    const deals = await listOpportunities({ includeClosed: true });
    expect(deals.find((d) => d.id === press)).toMatchObject({ kind: "press", nextAction: "keep_informed" });

    // The next step picks the template.
    await createTemplate({ projectId: sheet, name: "News", trigger: "keep_informed", subject: "Novedades", body: "Hola {{first_name}}" });
    await createTemplate({ projectId: sheet, name: "Hello", trigger: "first_contact", subject: "Hola", body: "Hola" });
    const [pressRow] = await getSheetRows(sheet, { ids: [press] });
    expect(suggestTemplate(pressRow, await listTemplates(sheet))?.name).toBe("News");
    const prepared = await prepareSheetEmails({ projectId: sheet, rowIds: [press] });
    expect(prepared).toMatchObject({ prepared: [{ rowId: press, templateName: "News" }], campaignId: null });

    // Rows of a sheet keep showing when their kind changes; other projects' goals never do.
    const [{ id: other }] = await sql<{ id: string }[]>`select id from projects where name = 'Press'`;
    await sql`insert into opportunities (title, kind, project_id) values ('Not a sheet', 'press', ${other})`;
    await expect(updateSheetRow((await sql<{ id: string }[]>`select id from opportunities where title = 'Not a sheet'`)[0].id, { stage: "won" })).rejects.toThrow(/not found/);
    expect((await getSheetRows(sheet)).length).toBe(4);
  });
});

async function addContactEmailFor(contactId: string, email: string) {
  await sql`insert into contact_emails (email, contact_id, is_primary) values (${email}, ${contactId}, true)`;
}
