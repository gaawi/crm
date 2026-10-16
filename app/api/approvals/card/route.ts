import { type NextRequest } from "next/server";
import { cardFor } from "@/lib/approvals/card-data";
import { assertSession, UnauthorizedError } from "@/lib/auth";

/**
 * GET /api/approvals/card?id=<draft id>: everything an approval flashcard
 * shows besides the email itself (the conversation on the front, the contact
 * on the back), in one request. A route handler rather than a server action so
 * the cards ahead load in parallel and never wait behind a send.
 */
export async function GET(request: NextRequest) {
  try {
    await assertSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response(null, { status: 401 });
    throw error;
  }
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid card" }, { status: 400 });
  return Response.json(await cardFor(id), { headers: { "Cache-Control": "private, no-store" } });
}
