import { assertSession, UnauthorizedError } from "@/lib/auth";
import { sql } from "@/lib/db";
import { safePhotoUrl } from "@/lib/contacts/photo";

/**
 * GET /api/contact-photo/[id] — a contact's photo (contacts.photo_url),
 * fetched by the server and served from Vela's own origin.
 *
 * Mail keeps its strict image policy (no remote hosts, so nothing in an email
 * can load an outside URL); avatars in the mail list come through here
 * instead. Only https raster images up to 3 MB, never SVG; cached privately
 * for a day. The photo's host sees Vela's server, not the browser.
 */

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const RASTER = /^image\/(?:jpeg|png|webp|gif|avif)$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(_request: Request, { params }: RouteContext<"/api/contact-photo/[id]">) {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
  const { id } = await params;
  if (!ID.test(id)) return notFound();
  const [row] = await sql<{ photoUrl: string | null }[]>`select photo_url from contacts where id = ${id}`;
  const url = safePhotoUrl(row?.photoUrl);
  if (!url) return notFound();

  let response: Response;
  try {
    response = await fetch(url, {
      // Some hosts (Wikimedia) refuse requests without a User-Agent.
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9", "User-Agent": "Vela/1.0 (private CRM; contact photos)" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return notFound();
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !RASTER.test(type) || !response.url.startsWith("https://")) return notFound();
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return notFound();
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > MAX_BYTES) return notFound();

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
