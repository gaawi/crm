import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { GET } from "@/app/api/contact-photo/[id]/route";
import { createContact } from "@/lib/queries/contacts";
import { useTestDatabase } from "../setup/db";

vi.mock("@/lib/auth", () => ({
  assertSession: async () => undefined,
  requireSession: async () => undefined,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function stubFetch(response: () => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = response();
    Object.defineProperty(r, "url", { value: String(url) });
    return r;
  });
  return calls;
}

const get = (id: string) => GET(new Request(`http://localhost/api/contact-photo/${id}`), { params: Promise.resolve({ id }) });

describe("contact photo proxy (avatars in Mail)", () => {
  useTestDatabase();
  afterEach(() => vi.unstubAllGlobals());

  async function contactWithPhoto(url: string | null) {
    const id = await createContact({ name: "Natasha", emails: [], status: "active" });
    await sql`update contacts set photo_url = ${url} where id = ${id}`;
    return id;
  }

  it("serves the contact's https photo from Vela's origin, privately cached and sandboxed", async () => {
    const id = await contactWithPhoto("https://photos.example.org/natasha.jpg");
    const calls = stubFetch(() => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(calls[0].url).toBe("https://photos.example.org/natasha.jpg");
    expect((calls[0].init?.headers as Record<string, string>)["User-Agent"]).toMatch(/Vela/);
  });

  it("refuses SVG, HTML, errors, oversized files, missing photos and bad ids", async () => {
    const id = await contactWithPhoto("https://photos.example.org/x");
    stubFetch(() => new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } }));
    expect((await get(id)).status).toBe(404);
    stubFetch(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await get(id)).status).toBe(404);
    stubFetch(() => new Response("nope", { status: 403, headers: { "content-type": "image/png" } }));
    expect((await get(id)).status).toBe(404);
    stubFetch(() => new Response(new Uint8Array(4 * 1024 * 1024), { status: 200, headers: { "content-type": "image/jpeg" } }));
    expect((await get(id)).status).toBe(404);

    const none = await contactWithPhoto(null);
    const calls = stubFetch(() => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
    expect((await get(none)).status).toBe(404);
    expect((await get("not-an-id")).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
