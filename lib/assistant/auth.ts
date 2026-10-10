import "server-only";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * The private API of the daily campaign assistant answers only
 * `Authorization: Bearer <ASSISTANT_API_TOKEN>` (constant-time compare).
 * Returns the response to send when the request is not allowed, else null.
 * While the token is unset the API does not exist (404).
 */
export function assistantApiGuard(request: Request): Response | null {
  const token = env.assistantApiToken;
  if (!token) return Response.json({ error: "Not found" }, { status: 404 });
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!bearer || !safeEqual(bearer, token)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  return null;
}
