import { jwtVerify, SignJWT } from "jose";

/**
 * Session token helpers, safe to import from proxy.ts (no server-only, no DB).
 * The token is an HS256 JWT signed with SESSION_SECRET.
 */

export const SESSION_COOKIE = "crm_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secretKey(secret: string | undefined = process.env.SESSION_SECRET): Uint8Array {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (≥ 32 characters)");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(secret?: string): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey(secret));
}

export async function verifySessionToken(token: string | undefined | null, secret?: string): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { algorithms: ["HS256"] });
    return payload.sub === "owner";
  } catch {
    return false;
  }
}
