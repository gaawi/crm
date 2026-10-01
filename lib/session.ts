import { jwtVerify, SignJWT } from "jose";

/**
 * Session and device token helpers, safe to import from proxy.ts (no
 * server-only, no DB). Tokens are HS256 JWTs.
 *
 * The session signing key is derived from SESSION_SECRET *and* APP_PASSWORD:
 * changing the password signs out every device (there is no session table).
 */

export const SESSION_COOKIE = "crm_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** Marks a browser that has signed in before (exempt from the global login lockout). */
export const DEVICE_COOKIE = "crm_device";
export const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

async function deriveKey(purpose: string, secret: string | undefined, password: string | undefined): Promise<Uint8Array> {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (≥ 32 characters)");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${purpose}:${password ?? ""}`));
  return new Uint8Array(mac);
}

const sessionKey = (secret = process.env.SESSION_SECRET, password = process.env.APP_PASSWORD) => deriveKey("session", secret, password);
const deviceKey = (secret = process.env.SESSION_SECRET) => deriveKey("device", secret, "");

export async function createSessionToken(secret?: string, password?: string): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(await sessionKey(secret, password));
}

export async function verifySessionToken(token: string | undefined | null, secret?: string, password?: string): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, await sessionKey(secret, password), { algorithms: ["HS256"] });
    return payload.sub === "owner";
  } catch {
    return false;
  }
}

export async function createDeviceToken(id: string): Promise<string> {
  return new SignJWT({ sub: "device", jti: id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DEVICE_MAX_AGE_SECONDS}s`)
    .sign(await deviceKey());
}

/** The device id of a valid device token, else null. */
export async function verifyDeviceToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await deviceKey(), { algorithms: ["HS256"] });
    return payload.sub === "device" && typeof payload.jti === "string" ? payload.jti : null;
  } catch {
    return null;
  }
}
