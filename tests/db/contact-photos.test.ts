import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { POST as photosPost } from "@/app/api/assistant-agent/contact-photos/route";
import { GET as contactsGet } from "@/app/api/assistant-agent/contacts/route";
import { addSheetRow, createSheet, getSheetRows } from "@/lib/queries/booking";
import { getContact } from "@/lib/queries/contacts";
import { setContactPhoto } from "@/lib/queries/contact-photos";
import { insertAccount, useTestDatabase } from "../setup/db";

const TOKEN = "test-assistant-token-0123456789";
const PHOTOS = "http://localhost:3000/api/assistant-agent/contact-photos";
const CONTACTS = "http://localhost:3000/api/assistant-agent/contacts";

function post(body: unknown, token: string | null = TOKEN) {
  return photosPost(
    new Request(PHOTOS, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function list(query: string, token: string | null = TOKEN) {
  return contactsGet(new Request(`${CONTACTS}${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
}

describe("contact photos API", () => {
  useTestDatabase();

  beforeEach(() => {
    process.env.ASSISTANT_API_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.ASSISTANT_API_TOKEN;
  });

  async function seed() {
    await insertAccount("me@example.com");
    const projectId = await createSheet({ name: "Press spring 2027" });
    await addSheetRow({ projectId, organization: "Festival Alpha", email: "ana@alpha.org", contactName: "Ana Alpha" });
    await addSheetRow({ projectId, organization: "Teatro Beta", email: "bo@beta.org", contactName: "Bo Beta" });
    const [{ id: ana }] = await sql<{ id: string }[]>`select contact_id as id from contact_emails where email = 'ana@alpha.org'`;
    const [{ id: bo }] = await sql<{ id: string }[]>`select contact_id as id from contact_emails where email = 'bo@beta.org'`;
    return { projectId, ana, bo };
  }

  it("is 404 without a configured token, 401 with a wrong one", async () => {
    delete process.env.ASSISTANT_API_TOKEN;
    expect((await post({ photos: [] })).status).toBe(404);
    expect((await list("?projectId=x")).status).toBe(404);
    process.env.ASSISTANT_API_TOKEN = TOKEN;
    expect((await post({ photos: [] }, "nope")).status).toBe(401);
    expect((await list("?projectId=x", null)).status).toBe(401);
  });

  it("rejects bad bodies and needs a project to list", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ photos: [] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await list("")).status).toBe(400);
    expect((await list("?projectId=00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("lists the campaign's people with their organization and photo", async () => {
    const { projectId, ana } = await seed();
    await setContactPhoto(ana, "https://alpha.org/ana.jpg", "https://alpha.org/team");
    const response = await list(`?projectId=${projectId}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ projectId, projectName: "Press spring 2027", count: 2 });
    expect(body.contacts[0]).toMatchObject({
      id: ana,
      name: "Ana Alpha",
      emails: ["ana@alpha.org"],
      organization: { name: "Festival Alpha", website: null },
      photoUrl: "https://alpha.org/ana.jpg",
      photoSource: "https://alpha.org/team",
    });
    expect(body.contacts[0].opportunityIds).toHaveLength(1);
    const missing = await (await list(`?projectId=${projectId}&missingPhoto=1`)).json();
    expect(missing.contacts.map((c: { name: string }) => c.name)).toEqual(["Bo Beta"]);
  });

  it("sets photos by contact id or email, with per-item results", async () => {
    const { projectId, ana, bo } = await seed();
    const response = await post({
      photos: [
        { contactId: ana, url: "https://alpha.org/img/ana.jpg", source: "https://alpha.org/about" },
        { email: "BO@beta.org", url: "https://beta.org/bo.png", source: "https://beta.org/equipo" },
        { email: "nobody@nowhere.org", url: "https://x.org/a.jpg", source: "https://x.org" },
        { contactId: ana, url: "http://alpha.org/ana.jpg", source: "https://alpha.org" },
        { contactId: ana, url: "https://alpha.org/ana.jpg", source: "ftp://alpha.org" },
        { contactId: ana, email: "bo@beta.org", url: "https://alpha.org/ana.jpg", source: "https://alpha.org" },
        { url: "https://alpha.org/ana.jpg", source: "https://alpha.org" },
        { contactId: "00000000-0000-4000-8000-000000000000", url: "https://alpha.org/ana.jpg", source: "https://alpha.org" },
        { contactId: "not-a-uuid", url: "https://alpha.org/ana.jpg", source: "https://alpha.org" },
      ],
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, updated: 2, failed: 7 });
    expect(body.results[0]).toEqual({ index: 0, ok: true, contactId: ana, photoUrl: "https://alpha.org/img/ana.jpg" });
    expect(body.results[1]).toEqual({ index: 1, ok: true, contactId: bo, photoUrl: "https://beta.org/bo.png" });
    const errors = body.results.slice(2).map((r: { ok: boolean; error: string }) => (r.ok ? "ok" : r.error));
    expect(errors[0]).toMatch(/No contact/);
    expect(errors[1]).toMatch(/^url: Only https/);
    expect(errors[2]).toMatch(/^source: Only https/);
    expect(errors[3]).toMatch(/different contacts/);
    expect(errors[4]).toMatch(/contactId or email/);
    expect(errors[5]).toMatch(/not found/);
    expect(errors[6]).toMatch(/contactId/);

    const contact = await getContact(ana);
    expect(contact).toMatchObject({ photoUrl: "https://alpha.org/img/ana.jpg", photoSource: "https://alpha.org/about" });
    expect(contact?.photoUpdatedAt).toBeInstanceOf(Date);
    // The campaign rows carry the photo for the avatars.
    const rows = await getSheetRows(projectId);
    expect(rows.find((r) => r.contact?.id === bo)?.contact?.photoUrl).toBe("https://beta.org/bo.png");
  });

  it("the database refuses non-https photos, and removing clears the source", async () => {
    const { ana } = await seed();
    await expect(sql`update contacts set photo_url = 'http://x.org/a.jpg' where id = ${ana}`).rejects.toThrow(/contacts_photo_url_https/);
    await expect(sql`update contacts set photo_source = 'javascript:alert(1)' where id = ${ana}`).rejects.toThrow(/contacts_photo_source_https/);
    await setContactPhoto(ana, "https://alpha.org/ana.jpg", "https://alpha.org/team");
    await setContactPhoto(ana, null, "https://alpha.org/team");
    expect(await getContact(ana)).toMatchObject({ photoUrl: null, photoSource: null });
  });
});
