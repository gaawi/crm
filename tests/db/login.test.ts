import { beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ ip: "1.1.1.1", cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": req.ip }),
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void req.cookies.set(name, value),
    delete: (name: string) => void req.cookies.delete(name),
  }),
}));

import { sql } from "@/lib/db";
import { recordLoginSuccess, reserveLoginAttempt } from "@/lib/login-throttle";
import { createDeviceToken, createSessionToken, DEVICE_COOKIE, verifySessionToken } from "@/lib/session";
import { safeNext } from "@/app/(auth)/login/safe-next";
import { useTestDatabase } from "../setup/db";

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("login throttle", () => {
  useTestDatabase();
  beforeEach(() => {
    req.ip = "1.1.1.1";
    req.cookies.clear();
  });

  it("cannot be bypassed with concurrent attempts", async () => {
    const results = await Promise.all(Array.from({ length: 40 }, () => reserveLoginAttempt()));
    expect(results.filter(Boolean)).toHaveLength(10);
  });

  it("never locks out a device that signed in before", async () => {
    // An attacker exhausts the global bucket from many IPs.
    for (let i = 0; i < 60; i++) {
      req.ip = `9.9.9.${i}`;
      await reserveLoginAttempt();
    }
    req.ip = "2.2.2.2";
    expect(await reserveLoginAttempt()).toBe(false); // unknown browser: locked
    req.cookies.set(DEVICE_COOKIE, await createDeviceToken("owner-iphone"));
    expect(await reserveLoginAttempt()).toBe(true); // the owner's device still gets in
  });

  it("forgets the client's attempts after a success", async () => {
    for (let i = 0; i < 9; i++) await reserveLoginAttempt();
    await recordLoginSuccess();
    const [{ failures }] = await sql<{ failures: number }[]>`select failures from login_attempts where bucket = 'global'`;
    expect(failures).toBe(8);
    expect(await reserveLoginAttempt()).toBe(true);
  });
});

describe("sessions and redirects", () => {
  it("are revoked by changing the password", async () => {
    const token = await createSessionToken(undefined, "old-password-123");
    expect(await verifySessionToken(token, undefined, "old-password-123")).toBe(true);
    expect(await verifySessionToken(token, undefined, "new-password-456")).toBe(false);
  });

  it.each([
    ["/contacts?x=1", "/contacts?x=1"],
    ["/\t/evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    ["/%09/evil.example", "/%09/evil.example"],
  ])("safeNext(%j) → %j", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
