import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ sql: () => [] }));

const { encryptPayload } = await import("@/lib/push/web-push");

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** The browser's side of RFC 8291, to check what the server encrypts. */
function decrypt(body: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const secret = ua.computeSecret(asPublic);
  const prkKey = hmac(auth, secret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString();
}

describe("encryptPayload (RFC 8291 aes128gcm)", () => {
  it("is readable by the subscription's keys", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const message = JSON.stringify({ title: "Laura Evans replied", body: "Thanks Guillermo…" });
    const body = encryptPayload(Buffer.from(message), ua.getPublicKey().toString("base64url"), auth.toString("base64url"));
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(decrypt(body, ua, auth)).toBe(message);
  });
});
