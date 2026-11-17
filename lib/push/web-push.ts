import "server-only";
import { createCipheriv, createECDH, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { importJWK, SignJWT, type JWK } from "jose";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Web Push without a library: VAPID (RFC 8292) to identify the app, and the
 * aes128gcm payload encryption of RFC 8291 so only the device can read it.
 * Works with Safari on iPhone (a web app added to the Home Screen, iOS 16.4+),
 * and with Chrome / Firefox.
 */

const b64url = (buf: Buffer) => buf.toString("base64url");
const fromB64url = (s: string) => Buffer.from(s, "base64url");

interface VapidKeys {
  /** Uncompressed P-256 point, base64url (what the browser's subscribe() wants). */
  publicKey: string;
  privateJwk: JWK;
}

let cached: VapidKeys | null = null;

/** The app's VAPID key pair, created and stored (private key encrypted) the first time. */
export async function vapidKeys(): Promise<VapidKeys> {
  if (cached) return cached;
  const [row] = await sql<{ value: { publicKey: string; privateEnc: string } }[]>`
    select value from app_settings where key = 'push_vapid'`;
  if (row?.value?.publicKey && row.value.privateEnc) {
    cached = { publicKey: row.value.publicKey, privateJwk: JSON.parse(decryptSecret(row.value.privateEnc)) as JWK };
    return cached;
  }
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), fromB64url(pub.x!), fromB64url(pub.y!)]);
  const keys: VapidKeys = { publicKey: b64url(raw), privateJwk: privateKey.export({ format: "jwk" }) as JWK };
  const value = { publicKey: keys.publicKey, privateEnc: encryptSecret(JSON.stringify(keys.privateJwk)) };
  // Two first calls at once: the first one stored wins, and everyone uses it.
  await sql`insert into app_settings (key, value, updated_at) values ('push_vapid', ${sql.json(value)}, now()) on conflict (key) do nothing`;
  cached = null;
  const [saved] = await sql<{ value: { publicKey: string; privateEnc: string } }[]>`select value from app_settings where key = 'push_vapid'`;
  cached = { publicKey: saved.value.publicKey, privateJwk: JSON.parse(decryptSecret(saved.value.privateEnc)) as JWK };
  return cached;
}

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** RFC 8291: the encrypted body for one subscription. */
export function encryptPayload(payload: Buffer, p256dh: string, auth: string): Buffer {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  const ecdh = createECDH("prime256v1");
  const asPublic = ecdh.generateKeys();
  const secret = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, secret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // One record: the payload, then the 0x02 "last record" delimiter.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

async function vapidHeader(endpoint: string, keys: VapidKeys): Promise<string> {
  const key = await importJWK({ ...keys.privateJwk, alg: "ES256" }, "ES256");
  const jwt = await new SignJWT({ sub: env.appUrl.startsWith("https://") ? env.appUrl : "mailto:noreply@example.com" })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setAudience(new URL(endpoint).origin)
    .setExpirationTime("12h")
    .sign(key);
  return `vapid t=${jwt}, k=${keys.publicKey}`;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url?: string;
  /** The number on the app icon (approvals + replies waiting). */
  badge?: number;
  /** Same tag = replaces the previous notification. */
  tag?: string;
}

interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Send to every device that turned notifications on. Gone devices are removed. Returns how many got it. */
export async function sendPush(message: PushMessage): Promise<number> {
  const subs = await sql<Subscription[]>`select id, endpoint, p256dh, auth from push_subscriptions`;
  if (!subs.length) return 0;
  const keys = await vapidKeys();
  const payload = Buffer.from(JSON.stringify(message));
  let delivered = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        const res = await fetch(s.endpoint, {
          method: "POST",
          headers: {
            Authorization: await vapidHeader(s.endpoint, keys),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
            Urgency: "high",
          },
          body: new Uint8Array(encryptPayload(payload, s.p256dh, s.auth)),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 404 || res.status === 410) {
          await sql`delete from push_subscriptions where id = ${s.id}`;
        } else if (res.ok) {
          delivered++;
          await sql`update push_subscriptions set last_used_at = now(), last_error = null where id = ${s.id}`;
        } else {
          const text = (await res.text().catch(() => "")).slice(0, 300);
          await sql`update push_subscriptions set last_error = ${`${res.status} ${text}`} where id = ${s.id}`;
        }
      } catch (error) {
        await sql`update push_subscriptions set last_error = ${String(error).slice(0, 300)} where id = ${s.id}`;
      }
    }),
  );
  return delivered;
}
