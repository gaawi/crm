import "server-only";
import { createHash } from "node:crypto";
import { safeEqual } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * The private API of the daily campaign assistant answers only
 * `Authorization: Bearer <token>` (constant-time compare). The token is
 * ASSISTANT_API_TOKEN, or — so it can be set without redeploying — the
 * SHA-256 stored in app_settings under "assistant_api_token" ({"sha256": hex}).
 * Returns the response to send when the request is not allowed, else null.
 * While no token is configured the API does not exist (404).
 */
export async function assistantApiGuard(request: Request): Promise<Response | null> {
  const token = env.assistantApiToken;
  let storedHash: string | null = null;
  if (!token) {
    const [row] = await sql<{ hash: string | null }[]>`
      select value->>'sha256' as hash from app_settings where key = 'assistant_api_token'`;
    storedHash = row?.hash ?? null;
    if (!storedHash) return Response.json({ error: "Not found" }, { status: 404 });
  }
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  const ok = bearer ? (token ? safeEqual(bearer, token) : safeEqual(createHash("sha256").update(bearer).digest("hex"), storedHash!)) : false;
  if (!ok) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  return null;
}
