import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { GET as profilesGet, POST as profilesPost } from "@/app/api/assistant-agent/profiles/route";
import { orgProfileSchema, parseImageLines, parseLinkLines, parseVenueLines, readProfile } from "@/lib/organizations/profile";
import { addSheetRow, createSheet } from "@/lib/queries/booking";
import { getOrganizationProfile, getOrganizationWithProfile } from "@/lib/queries/org-profiles";
import { getDraft } from "@/lib/queries/drafts";
import { insertAccount, useTestDatabase } from "../setup/db";

const TOKEN = "test-assistant-token-0123456789";
const BASE = "http://localhost:3000/api/assistant-agent/profiles";

function get(query: string, token: string | null = TOKEN) {
  return profilesGet(new Request(`${BASE}${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
}

function post(body: unknown, token: string | null = TOKEN) {
  return profilesPost(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const PROFILE = {
  summary: "A summer festival of new music and dance in the old town. Three weeks of premieres every July.",
  kind: "festival",
  programming: "Contemporary music, dance, site-specific work",
  venues: [{ name: "Cloister", type: "outdoor stage", capacity: 600 }],
  location: "Girona, Spain",
  dates: "July",
  fitForAdar: "They commission site-specific pieces.",
  ideas: ["Pitch the cloister piece", "Offer a workshop"],
  images: [{ url: "https://example.org/a.jpg", caption: "Cloister at night" }],
  links: [{ label: "Website", url: "https://example.org" }],
  sources: ["https://example.org/about"],
};

describe("organization profiles API", () => {
  useTestDatabase();

  beforeEach(() => {
    process.env.ASSISTANT_API_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.ASSISTANT_API_TOKEN;
  });

  async function seed() {
    await insertAccount("me@example.com");
    const projectId = await createSheet({ name: "Festivals 2027" });
    const a = await addSheetRow({ projectId, organization: "Festival Alpha", email: "ana@alpha.org", contactName: "Ana" });
    const b = await addSheetRow({ projectId, organization: "Teatro Beta", email: "bo@beta.org", contactName: "Bo" });
    const [{ id: orgA }] = await sql<{ id: string }[]>`select id from organizations where name = 'Festival Alpha'`;
    const [{ id: orgB }] = await sql<{ id: string }[]>`select id from organizations where name = 'Teatro Beta'`;
    return { projectId, rowA: a, rowB: b, orgA, orgB };
  }

  it("is 404 without a configured token, 401 with a wrong one", async () => {
    delete process.env.ASSISTANT_API_TOKEN;
    expect((await get("?projectId=x")).status).toBe(404);
    expect((await post({ profiles: [] })).status).toBe(404);
    process.env.ASSISTANT_API_TOKEN = TOKEN;
    expect((await get("?projectId=x", null)).status).toBe(401);
    expect((await post({ profiles: [] }, "nope")).status).toBe(401);
  });

  it("rejects bad bodies and lists need a project", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ profiles: [] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await get("")).status).toBe(400);
    expect((await get("?projectId=00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("sets a profile by organization, opportunity and contact email", async () => {
    const { rowA, rowB, orgA, orgB } = await seed();
    const res = await post({
      profiles: [
        { organizationId: orgA, profile: PROFILE },
        { opportunityId: rowB, profile: { ...PROFILE, summary: "A municipal theatre.", kind: "venue" } },
        { contactEmail: "ANA@alpha.org", profile: { ...PROFILE, summary: "Updated through the email." } },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, updated: 3, failed: 0 });
    expect(body.results.map((r: { organizationId: string }) => r.organizationId)).toEqual([orgA, orgB, orgA]);

    const a = await getOrganizationProfile(orgA);
    expect(a?.profile).toMatchObject({ summary: "Updated through the email.", kind: "festival", researchedBy: "claude" });
    expect(a?.profile?.researchedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(a?.profileUpdatedAt).toBeInstanceOf(Date);
    expect(a?.profile?.venues).toEqual([{ name: "Cloister", type: "outdoor stage", capacity: 600 }]);
    expect((await getOrganizationProfile(orgB))?.profile?.kind).toBe("venue");
    // The opportunity resolves to the same organization the sheet row shows.
    expect((await getOrganizationWithProfile(orgB))?.name).toBe("Teatro Beta");
    expect(rowA).toBeTruthy();
  });

  it("validates each item on its own", async () => {
    const { orgA, orgB } = await seed();
    const res = await post({
      profiles: [
        { organizationId: orgA, profile: { ...PROFILE, images: [{ url: "http://insecure.example/a.jpg" }] } },
        { organizationId: orgA, profile: { ...PROFILE, summary: "" } },
        { organizationId: orgA, profile: { ...PROFILE, images: Array.from({ length: 9 }, (_, i) => ({ url: `https://x.org/${i}.jpg` })) } },
        { contactEmail: "nobody@nowhere.org", profile: PROFILE },
        { profile: PROFILE },
        { organizationId: orgA, opportunityId: null, contactEmail: "bo@beta.org", profile: PROFILE },
        { organizationId: "00000000-0000-4000-8000-000000000000", profile: PROFILE },
        { organizationId: orgB, profile: { ...PROFILE, links: [{ label: "x", url: "javascript:alert(1)" }] } },
        { organizationId: orgB, profile: { summary: "Short and valid.", kind: null, venues: null, location: "" } },
      ],
    });
    const body = await res.json();
    expect(body.updated).toBe(1);
    const errors = body.results.map((r: { ok: boolean; error?: string }) => (r.ok ? "ok" : r.error));
    expect(errors[0]).toMatch(/images\.0\.url.*https/);
    expect(errors[1]).toMatch(/summary/);
    expect(errors[2]).toMatch(/images/);
    expect(errors[3]).toMatch(/nobody@nowhere\.org/);
    expect(errors[4]).toMatch(/organizationId, opportunityId or contactEmail/);
    expect(errors[5]).toMatch(/different organizations/);
    expect(errors[6]).toMatch(/not found/);
    expect(errors[7]).toMatch(/links\.0\.url/);
    expect(errors[8]).toBe("ok");
    expect((await getOrganizationProfile(orgA))?.profile).toBeNull();
    expect((await getOrganizationProfile(orgB))?.profile).toEqual({
      summary: "Short and valid.",
      researchedBy: "claude",
      researchedAt: expect.any(String),
    });
  });

  it("lists the sheet's organizations with their profile, or only those missing one", async () => {
    const { projectId, rowA, orgA, orgB } = await seed();
    await post({ profiles: [{ organizationId: orgA, profile: PROFILE }] });

    const all = await (await get(`?projectId=${projectId}`)).json();
    expect(all).toMatchObject({ projectId, projectName: "Festivals 2027", count: 2, missingCount: 1 });
    const alpha = all.organizations.find((o: { id: string }) => o.id === orgA);
    expect(alpha).toMatchObject({ name: "Festival Alpha", opportunityIds: [rowA], contactEmails: ["ana@alpha.org"] });
    expect(alpha.profile.summary).toBe(PROFILE.summary);
    expect(alpha.profileUpdatedAt).toEqual(expect.any(String));

    const missing = await (await get(`?projectId=${projectId}&missing=1`)).json();
    expect(missing.organizations.map((o: { id: string; profile: unknown }) => [o.id, o.profile])).toEqual([[orgB, null]]);
  });

  it("shows the profile on the drafts of the organization's contacts", async () => {
    const { rowA, orgA } = await seed();
    await post({ profiles: [{ opportunityId: rowA, profile: PROFILE }] });
    const [{ id: accountId }] = await sql<{ id: string }[]>`select id from gmail_accounts limit 1`;
    const [{ contactId }] = await sql<{ contactId: string }[]>`select contact_id from opportunities where id = ${rowA}`;
    const [{ id }] = await sql<{ id: string }[]>`
      insert into email_drafts (account_id, contact_id, to_emails, subject, body_text)
      values (${accountId}, ${contactId}, '{ana@alpha.org}', 'Hello', 'Hi Ana') returning id`;
    const draft = await getDraft(id);
    expect(draft?.organization).toMatchObject({ id: orgA, name: "Festival Alpha", profile: { summary: PROFILE.summary } });
  });
});

describe("profile parsing", () => {
  it("parses the owner's venue, image and link lines", () => {
    expect(parseVenueLines("Main hall — black box theatre — 450\nCloister - outdoor stage - 1,200 seats - summer only\nStudio — 80")).toEqual([
      { name: "Main hall", type: "black box theatre", capacity: 450 },
      { name: "Cloister", type: "outdoor stage", capacity: 1200, notes: "summer only" },
      { name: "Studio", capacity: 80 },
    ]);
    expect(parseImageLines("https://a.org/x.jpg — The hall\nhttps://a.org/y.jpg")).toEqual({
      images: [
        { url: "https://a.org/x.jpg", caption: "The hall" },
        { url: "https://a.org/y.jpg", caption: undefined },
      ],
    });
    expect(parseImageLines("http://a.org/x.jpg").invalid).toBe("http://a.org/x.jpg");
    expect(parseLinkLines("Program 2026 — https://fest.org/program\nhttps://www.fest.org/")).toEqual({
      links: [
        { label: "Program 2026", url: "https://fest.org/program" },
        { label: "fest.org", url: "https://www.fest.org/" },
      ],
    });
  });

  it("reads stored values defensively", () => {
    expect(readProfile(null)).toBeNull();
    expect(readProfile({ nope: 1 })).toBeNull();
    expect(readProfile({ summary: "Hi", researchedAt: "2026-10-01" })?.researchedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(orgProfileSchema.safeParse({ summary: "x".repeat(1501) }).success).toBe(false);
  });
});
