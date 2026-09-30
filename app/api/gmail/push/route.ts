import { after } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { deadlineFor, handlePushNotification } from "@/lib/sync/runner";

export const maxDuration = 300;

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
let googleKeys: ReturnType<typeof createRemoteJWKSet> | null = null;

function googleJwks() {
  googleKeys ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  return googleKeys;
}

/** Pub/Sub's OIDC token: Google-signed, our audience, and (if configured) our service account. */
async function verifyPushToken(request: Request, audience: string): Promise<boolean> {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  if (!bearer) return false;
  try {
    const { payload } = await jwtVerify(bearer, googleJwks(), { issuer: GOOGLE_ISSUERS, audience });
    const serviceAccount = env.pubsubServiceAccount;
    if (serviceAccount) {
      const verified = payload.email_verified === true || payload.email_verified === "true";
      if (payload.email !== serviceAccount || !verified) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** `message.data` = base64 JSON {emailAddress, historyId}; null when malformed. */
function decodePushPayload(body: unknown): { emailAddress: string; historyId: string } | null {
  try {
    const data = (body as { message?: { data?: unknown } } | null)?.message?.data;
    if (typeof data !== "string" || data === "") return null;
    const decoded: unknown = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    if (!decoded || typeof decoded !== "object") return null;
    const { emailAddress, historyId } = decoded as { emailAddress?: unknown; historyId?: unknown };
    if (typeof emailAddress !== "string" || !emailAddress.includes("@")) return null;
    return { emailAddress, historyId: historyId === undefined || historyId === null ? "" : String(historyId) };
  } catch {
    return null;
  }
}

/**
 * POST /api/gmail/push?token=… — Gmail → Pub/Sub push subscription.
 * Acknowledges at once (204) and syncs in after(). The payload only
 * identifies the account; its historyId is not trusted.
 */
export async function POST(request: Request) {
  const start = Date.now();
  const expected = env.pubsubVerificationToken;
  if (!expected) return new Response(null, { status: 404 });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token || !safeEqual(token, expected)) return Response.json({ error: "forbidden" }, { status: 403 });

  const audience = env.pubsubAudience;
  if (audience && !(await verifyPushToken(request, audience))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const payload = decodePushPayload(body);
  if (!payload) {
    // Acknowledge anyway: Pub/Sub would redeliver a malformed message forever.
    console.warn("Ignoring malformed Pub/Sub push message");
    return new Response(null, { status: 204 });
  }

  const deadline = deadlineFor(maxDuration, start);
  after(async () => {
    try {
      await handlePushNotification(payload, { deadline });
    } catch (error) {
      console.error("Push sync failed", error);
    }
  });
  return new Response(null, { status: 204 });
}
