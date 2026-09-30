import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import {
  addContactEmail,
  createContact,
  dismissReply,
  EmailTakenError,
  findDuplicateCandidates,
  getContact,
  getContactByEmail,
  getContactHistory,
  listContacts,
  listTags,
  mergeContacts,
  removeContactEmail,
  updateContact,
} from "@/lib/queries/contacts";
import {
  createOrganization,
  findOrCreateOrganization,
  getOrganizationContacts,
  getOrganizationHistory,
  listOrganizations,
  normalizeDomains,
} from "@/lib/queries/organizations";
import { createProject, getProjectByName, listProjects } from "@/lib/queries/projects";
import { createOpportunity, listOpportunities, updateOpportunity, getOpportunity } from "@/lib/queries/opportunities";
import { recentActivity, searchMessages } from "@/lib/queries/messages";
import { getFollowUps } from "@/lib/queries/followups";
import { insertAccount, useTestDatabase } from "../setup/db";

interface FakeMessage {
  accountId: string;
  gmailId: string;
  rfc822?: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body?: string;
  sentAt: string | Date;
  automated?: boolean;
}

async function insertMessage(m: FakeMessage): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into messages (account_id, gmail_message_id, gmail_thread_id, rfc822_message_id, direction,
                          from_email, subject, snippet, body_text, sent_at, is_automated)
    values (${m.accountId}, ${m.gmailId}, ${"t-" + m.gmailId}, ${m.rfc822 ?? null}, ${m.direction},
            ${m.from}, ${m.subject}, ${(m.body ?? "").slice(0, 50)}, ${m.body ?? null}, ${new Date(m.sentAt)}, ${m.automated ?? false})
    returning id
  `;
  const rows = [
    { role: "from", email: m.from },
    ...m.to.map((email) => ({ role: "to", email })),
    ...(m.cc ?? []).map((email) => ({ role: "cc", email })),
  ];
  for (const r of rows) {
    await sql`insert into message_participants (message_id, role, email) values (${row.id}, ${r.role}, ${r.email}) on conflict do nothing`;
  }
  return row.id;
}

async function refreshAll() {
  await sql`select refresh_contact_stats(array(select id from contacts))`;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("query layer", () => {
  useTestDatabase();

  it("creates contacts, rejects taken addresses, filters and sorts", async () => {
    const press = await getProjectByName("press");
    const id = await createContact({
      name: "  Jane   Doe ",
      emails: ["Jane@Example.org", "jane@example.org", "jd@gmail.com"],
      organizationName: "Example Foundation",
      role: "Curator",
      tags: ["Art Fair", "vip"],
      projectIds: [press!.id],
    });
    const jane = await getContact(id);
    expect(jane).toMatchObject({
      name: "Jane Doe",
      displayName: "Jane Doe",
      primaryEmail: "jane@example.org",
      emails: ["jane@example.org", "jd@gmail.com"],
      role: "Curator",
      tags: ["art-fair", "vip"],
      status: "active",
      source: "manual",
    });
    expect(jane?.organization?.name).toBe("Example Foundation");
    expect(jane?.projects.map((p) => p.name)).toEqual(["Press"]);

    await expect(createContact({ name: "Other", emails: ["JD@gmail.com"] })).rejects.toBeInstanceOf(EmailTakenError);

    await createContact({ name: "Bob", emails: ["bob@acme.com"], tags: ["vip"] });
    await createContact({ name: "Archived Person", emails: ["old@acme.com"], status: "archived" });

    expect((await listContacts()).total).toBe(2);
    expect((await listContacts({ status: "all" })).total).toBe(3);
    expect((await listContacts({ q: "curat" })).contacts.map((c) => c.name)).toEqual(["Jane Doe"]);
    expect((await listContacts({ q: "acme" })).contacts.map((c) => c.name)).toEqual(["Bob"]);
    expect((await listContacts({ q: "Example Found" })).contacts.map((c) => c.name)).toEqual(["Jane Doe"]);
    expect((await listContacts({ tag: "VIP", sort: "name" })).contacts.map((c) => c.name)).toEqual(["Bob", "Jane Doe"]);
    expect((await listContacts({ projectId: press!.id })).contacts).toHaveLength(1);
    expect(await listTags()).toEqual([
      { tag: "vip", count: 2 },
      { tag: "art-fair", count: 1 },
    ]);
    expect((await getContactByEmail("JD@GMAIL.COM"))?.id).toBe(id);
  });

  it("patches only given fields and replaces projects", async () => {
    const id = await createContact({ name: "Ann", emails: ["ann@x.org"], role: "Writer", notes: "hello" });
    const grants = await getProjectByName("Grants");
    await updateContact(id, { followUpAt: "2026-10-05", projectIds: [grants!.id], tags: ["B", "a"] });
    let ann = await getContact(id);
    expect(ann).toMatchObject({ role: "Writer", notes: "hello", followUpAt: "2026-10-05", tags: ["a", "b"] });
    expect(ann?.projects.map((p) => p.name)).toEqual(["Grants"]);
    await updateContact(id, { role: null, organizationName: "Ann Org", projectIds: [] });
    ann = await getContact(id);
    expect(ann?.role).toBeNull();
    expect(ann?.organization?.name).toBe("Ann Org");
    expect(ann?.projects).toEqual([]);
  });

  it("merges history across addresses and accounts, de-duplicated", async () => {
    const a1 = await insertAccount("me@creartbox.nyc");
    const a2 = await insertAccount("me@gmail.com");
    const jane = await createContact({ name: "Jane", emails: ["jane@org.com"] });
    const janeDup = await createContact({ name: null, emails: ["jane.personal@gmail.com"], tags: ["friend"] });

    // Same email delivered to both of my accounts → two rows, one history item.
    await insertMessage({ accountId: a1, gmailId: "g1", rfc822: "<m1@x>", direction: "inbound", from: "jane@org.com", to: ["me@creartbox.nyc", "me@gmail.com"], subject: "Residency proposal", body: "Would you consider a grant application?", sentAt: daysAgo(10) });
    await insertMessage({ accountId: a2, gmailId: "h1", rfc822: "<m1@x>", direction: "inbound", from: "jane@org.com", to: ["me@creartbox.nyc", "me@gmail.com"], subject: "Residency proposal", body: "Would you consider a grant application?", sentAt: daysAgo(10) });
    await insertMessage({ accountId: a1, gmailId: "g2", rfc822: "<m2@x>", direction: "outbound", from: "me@creartbox.nyc", to: ["jane@org.com"], subject: "Re: Residency proposal", body: "Yes!", sentAt: daysAgo(9) });
    await insertMessage({ accountId: a2, gmailId: "h2", rfc822: "<m3@x>", direction: "inbound", from: "jane.personal@gmail.com", to: ["me@gmail.com"], subject: "Dinner", body: "Dinner friday?", sentAt: daysAgo(2) });
    await refreshAll();

    let history = await getContactHistory(jane);
    expect(history.map((m) => m.subject)).toEqual(["Re: Residency proposal", "Residency proposal"]);
    expect(history[1].accounts.sort()).toEqual(["me@creartbox.nyc", "me@gmail.com"]);
    expect(history[1].to.map((a) => a.email)).toEqual(["me@creartbox.nyc", "me@gmail.com"]);
    expect(history[0].gmailUrl).toContain("authuser=me%40creartbox.nyc");

    const dupes = await findDuplicateCandidates(jane);
    expect(dupes).toEqual([]);

    await mergeContacts(jane, janeDup);
    history = await getContactHistory(jane);
    expect(history.map((m) => m.subject)).toEqual(["Dinner", "Re: Residency proposal", "Residency proposal"]);
    const merged = await getContact(jane);
    expect(merged).toMatchObject({ messageCount: 3, tags: ["friend"], emails: ["jane@org.com", "jane.personal@gmail.com"] });
    expect(merged?.lastInboundAt?.getTime()).toBeGreaterThan(merged!.lastOutboundAt!.getTime());
    expect(await getContact(janeDup)).toBeNull();

    // Paging + full-text filter.
    expect((await getContactHistory(jane, { limit: 1 })).map((m) => m.subject)).toEqual(["Dinner"]);
    expect((await getContactHistory(jane, { q: "grants" })).map((m) => m.subject)).toEqual(["Residency proposal"]);

    // Addresses: move/remove.
    await expect(addContactEmail(jane, "not-an-email")).rejects.toThrow();
    await removeContactEmail(jane, "jane@org.com");
    expect((await getContact(jane))?.primaryEmail).toBe("jane.personal@gmail.com");
    await expect(removeContactEmail(jane, "jane.personal@gmail.com")).rejects.toThrow(/at least one/);
    expect((await getContact(jane))?.messageCount).toBe(1);
  });

  it("finds duplicate candidates by name and address local part", async () => {
    const a = await createContact({ name: "Maria Lopez", emails: ["maria.lopez@studio.com"] });
    await createContact({ name: "maria lopez", emails: ["ml@gmail.com"] });
    await createContact({ name: "M. L.", emails: ["maria.lopez@gmail.com"] });
    await createContact({ name: "Info", emails: ["info@studio.com"] });
    const dupes = await findDuplicateCandidates(a);
    expect(dupes.map((d) => d.primaryEmail).sort()).toEqual(["maria.lopez@gmail.com", "ml@gmail.com"]);
  });

  it("computes follow-up lists", async () => {
    const acc = await insertAccount("me@creartbox.nyc");
    const today = new Date().toISOString().slice(0, 10);
    const dueId = await createContact({ name: "Due", emails: ["due@x.com"], followUpAt: "2020-01-01" });
    const future = await createContact({ name: "Future", emails: ["future@x.com"], followUpAt: "2999-01-01" });
    const needs = await createContact({ name: "Needs", emails: ["needs@x.com"] });
    const awaiting = await createContact({ name: "Awaiting", emails: ["awaiting@x.com"] });
    const recent = await createContact({ name: "Recent", emails: ["recent@x.com"] });
    const replied = await createContact({ name: "Replied", emails: ["replied@x.com"] });
    await createContact({ name: "Archived", emails: ["arch@x.com"], status: "archived", followUpAt: "2020-01-01" });

    await insertMessage({ accountId: acc, gmailId: "n1", direction: "inbound", from: "needs@x.com", to: ["me@creartbox.nyc"], subject: "Q?", sentAt: daysAgo(1) });
    await insertMessage({ accountId: acc, gmailId: "w1", direction: "outbound", from: "me@creartbox.nyc", to: ["awaiting@x.com"], subject: "Offer", sentAt: daysAgo(12) });
    await insertMessage({ accountId: acc, gmailId: "r1", direction: "outbound", from: "me@creartbox.nyc", to: ["recent@x.com"], subject: "Hi", sentAt: daysAgo(2) });
    await insertMessage({ accountId: acc, gmailId: "p1", direction: "inbound", from: "replied@x.com", to: ["me@creartbox.nyc"], subject: "Q", sentAt: daysAgo(5) });
    await insertMessage({ accountId: acc, gmailId: "p2", direction: "outbound", from: "me@creartbox.nyc", to: ["replied@x.com"], subject: "A", sentAt: daysAgo(4) });
    await insertMessage({ accountId: acc, gmailId: "p3", direction: "inbound", from: "replied@x.com", to: ["me@creartbox.nyc"], subject: "Thanks", sentAt: daysAgo(3) });
    await refreshAll();

    const opp = await createOpportunity({ title: "Summer show", contactId: needs, followUpAt: "2020-02-02" });
    await createOpportunity({ title: "Closed", stage: "won", followUpAt: "2020-02-02" });

    let lists = await getFollowUps({ today });
    expect(lists.due.map((c) => c.id)).toEqual([dueId]);
    expect(lists.needsReply.map((c) => c.name)).toEqual(["Needs", "Replied"]);
    expect(lists.awaitingReply.map((c) => c.name)).toEqual(["Awaiting"]);
    expect(lists.opportunities.map((o) => o.id)).toEqual([opp]);
    expect(lists.due.find((c) => c.id === future)).toBeUndefined();
    void awaiting;
    void recent;

    await dismissReply(replied);
    lists = await getFollowUps({ today });
    expect(lists.needsReply.map((c) => c.name)).toEqual(["Needs"]);
  });

  it("organizations: domains, contacts and correspondence", async () => {
    const acc = await insertAccount("me@creartbox.nyc");
    const c1 = await createContact({ name: "Curator", emails: ["curator@moma.org"] });
    await insertMessage({ accountId: acc, gmailId: "o1", direction: "inbound", from: "curator@moma.org", to: ["me@creartbox.nyc"], subject: "Show", sentAt: daysAgo(3) });
    await insertMessage({ accountId: acc, gmailId: "o2", direction: "inbound", from: "intern@moma.org", to: ["me@creartbox.nyc"], subject: "Logistics", sentAt: daysAgo(1) });
    await insertMessage({ accountId: acc, gmailId: "o3", direction: "inbound", from: "someone@else.com", to: ["me@creartbox.nyc"], subject: "Other", sentAt: daysAgo(1) });
    await refreshAll();

    expect(normalizeDomains(["https://www.MoMA.org/about", "@moma.org", "bad", " "])).toEqual(["moma.org"]);
    const org = await createOrganization({ name: "MoMA", domains: ["www.moma.org"] });
    expect((await getContact(c1))?.organization?.id).toBe(org);
    expect((await getOrganizationContacts(org)).map((c) => c.name)).toEqual(["Curator"]);
    expect((await getOrganizationHistory(org)).map((m) => m.subject)).toEqual(["Logistics", "Show"]);
    const [listed] = await listOrganizations({ q: "moma" });
    expect(listed).toMatchObject({ name: "MoMA", contactCount: 1 });
    expect(await findOrCreateOrganization("moma")).toBe(org);
  });

  it("projects and opportunities", async () => {
    const id = await createProject({ name: "Residency 2027", color: "orange" });
    await expect(createProject({ name: "residency 2027" })).rejects.toThrow(/already exists/);
    const projects = await listProjects();
    expect(projects.at(-1)).toMatchObject({ id, name: "Residency 2027", color: "orange", contactCount: 0 });

    const org = await findOrCreateOrganization("Gallery X");
    const contact = await createContact({ name: "Gal", emails: ["gal@galleryx.com"], organizationId: org });
    const opp = await createOpportunity({ title: "Group show", contactId: contact, projectId: id, value: "$2,500", stage: "proposal" });
    let o = await getOpportunity(opp);
    expect(o).toMatchObject({ title: "Group show", value: "2500.00", stage: "proposal", closedAt: null });
    expect(o?.organization?.id).toBe(org);
    expect(o?.contact?.displayName).toBe("Gal");
    expect(o?.project?.name).toBe("Residency 2027");

    await updateOpportunity(opp, { stage: "won" });
    o = await getOpportunity(opp);
    expect(o?.closedAt).toBeInstanceOf(Date);
    expect(await listOpportunities()).toHaveLength(0);
    expect(await listOpportunities({ includeClosed: true })).toHaveLength(1);
    await updateOpportunity(opp, { stage: "negotiation" });
    expect((await getOpportunity(opp))?.closedAt).toBeNull();
    expect((await listProjects()).find((p) => p.id === id)?.openOpportunityCount).toBe(1);
  });

  it("searches messages and lists recent activity", async () => {
    const a1 = await insertAccount("me@creartbox.nyc");
    const a2 = await insertAccount("me@gmail.com");
    const c = await createContact({ name: "Press Person", emails: ["writer@magazine.com"] });
    await insertMessage({ accountId: a1, gmailId: "s1", rfc822: "<s1@x>", direction: "inbound", from: "writer@magazine.com", to: ["me@creartbox.nyc", "me@gmail.com"], subject: "Interview request", body: "We would love to feature the exhibition", sentAt: daysAgo(4) });
    await insertMessage({ accountId: a2, gmailId: "t1", rfc822: "<s1@x>", direction: "inbound", from: "writer@magazine.com", to: ["me@creartbox.nyc", "me@gmail.com"], subject: "Interview request", body: "We would love to feature the exhibition", sentAt: daysAgo(4) });
    await insertMessage({ accountId: a1, gmailId: "s2", direction: "inbound", from: "news@shop.com", to: ["me@creartbox.nyc"], subject: "Sale on exhibitions", body: "exhibition sale", sentAt: daysAgo(1), automated: true });
    await refreshAll();

    const hits = await searchMessages({ q: "exhibitions" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ subject: "Interview request" });
    expect(hits[0].contacts).toEqual([{ id: c, displayName: "Press Person" }]);
    expect(hits[0].rank).toBeGreaterThan(0);
    expect(await searchMessages({ q: "exhibitions", includeAutomated: true })).toHaveLength(2);
    expect(await searchMessages({ contactId: c })).toHaveLength(1);

    const activity = await recentActivity(10);
    expect(activity.map((m) => m.subject)).toEqual(["Interview request"]);
    expect(activity[0].contact?.id).toBe(c);
  });
});
