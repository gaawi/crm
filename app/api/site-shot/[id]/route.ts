import { assertSession, UnauthorizedError } from "@/lib/auth";
import { sql } from "@/lib/db";
import { screenshotPage } from "@/lib/sites/screenshot";

/**
 * GET /api/site-shot/[id]?url=… — a screenshot of one of an organization's
 * pages (its website or a link in its profile), so the owner recognizes the
 * organization by the look of its site.
 *
 * Only URLs stored on that organization are opened (never an arbitrary
 * address). The picture is taken by the server's own browser, then cached by
 * the CDN for a month: the first view takes a few seconds, the next ones are
 * instant. The site sees Vela's server, not the owner's browser.
 */

export const maxDuration = 60;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalize(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

// Not cached: a page that failed to load (slow, down for a moment) is tried again next time.
function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function GET(request: Request, { params }: RouteContext<"/api/site-shot/[id]">) {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
  const { id } = await params;
  const wanted = normalize(new URL(request.url).searchParams.get("url") ?? "");
  if (!ID.test(id) || !wanted) return notFound();

  const [org] = await sql<{ website: string | null; links: unknown }[]>`
    select website, profile->'links' as links from organizations where id = ${id}`;
  if (!org) return notFound();
  const stored = [org.website, ...(Array.isArray(org.links) ? org.links.map((l) => (l as { url?: unknown })?.url) : [])]
    .filter((u): u is string => typeof u === "string")
    .map(normalize);
  if (!stored.includes(wanted)) return notFound();

  const shot = await screenshotPage(wanted);
  if (!shot) return notFound();
  return new Response(shot, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(shot.byteLength),
      "Cache-Control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=2592000",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
