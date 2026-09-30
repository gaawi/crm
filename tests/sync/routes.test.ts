import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { decryptSecret } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { createSessionToken } from "@/lib/session";
import { useTestDatabase } from "../setup/db";
import { FakeGmail } from "../helpers/fake-gmail";
import { accountRow, insertConnectedAccount, storedIds, useFastGmailClients } from "../helpers/sync";

// after() runs the callback inline; tests await `flushAfter()`.
const { pending } = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: unknown) => {
      pending.push(Promise.resolve(typeof task === "function" ? (task as () => unknown)() : task));
    },
  };
});
vi.mock("@/lib/ai/autopilot", () => ({
  runAutopilotIfDue: async () => ({ ran: false, proposed: 0, skipped: 0, errors: [] }),
}));

import { GET as connect } from "@/app/api/google/connect/route";
import { GET as callback } from "@/app/api/google/callback/route";
import { POST as push } from "@/app/api/gmail/push/route";
import { POST as syncRoute } from "@/app/api/sync/[accountId]/route";
import { GET as cron } from "@/app/api/cron/sync/route";
import { GET as accounts } from "@/app/api/accounts/route";

async function flushAfter() {
  while (pending.length) await Promise.all(pending.splice(0));
}

const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const AUDIENCE = "https://crm.example.com/api/gmail/push";
const keys = vi.hoisted(() => ({ jwks: null as unknown, sign: null as null | ((claims: Record<string, unknown>) => Promise<string>) }));

let fake: FakeGmail;
let session: string;

function useFake() {
  fake = new FakeGmail();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (url === CERTS_URL) return Response.json(keys.jwks);
    return fake.fetch(input, init);
  });
}

function pushRequest(query: string, data: unknown, headers: Record<string, string> = {}) {
  const encoded = typeof data === "string" ? data : Buffer.from(JSON.stringify(data)).toString("base64");
  return new Request(`http://localhost:3000/api/gmail/push${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ message: { data: encoded, messageId: "1" }, subscription: "projects/p/subscriptions/s" }),
  });
}

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("sync routes", () => {
  useTestDatabase();
  useFastGmailClients();

  beforeEach(async () => {
    pending.length = 0;
    session = `crm_session=${await createSessionToken()}`;
    useFake();
    if (!keys.sign) {
      const { publicKey, privateKey } = await generateKeyPair("RS256");
      keys.jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
      keys.sign = (claims) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer("https://accounts.google.com")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of ["PUBSUB_VERIFICATION_TOKEN", "PUBSUB_AUDIENCE", "PUBSUB_SERVICE_ACCOUNT", "GMAIL_PUBSUB_TOPIC"]) {
      delete process.env[name];
    }
  });

  describe("POST /api/gmail/push", () => {
    it("is 404 when push is not configured and 403 with a wrong token", async () => {
      expect((await push(pushRequest("?token=x", { emailAddress: fake.email, historyId: 1 }))).status).toBe(404);
      process.env.PUBSUB_VERIFICATION_TOKEN = "push-secret";
      expect((await push(pushRequest("?token=wrong", { emailAddress: fake.email, historyId: 1 }))).status).toBe(403);
      expect((await push(pushRequest("", { emailAddress: fake.email, historyId: 1 }))).status).toBe(403);
      expect(pending).toHaveLength(0);
    });

    it("acknowledges and syncs in after(); malformed messages are acknowledged and ignored", async () => {
      process.env.PUBSUB_VERIFICATION_TOKEN = "push-secret";
      const accountId = await insertConnectedAccount(fake.email, { history_id: fake.historyId, backfill_status: "done" });
      const fresh = fake.addMessage();

      const response = await push(pushRequest("?token=push-secret", { emailAddress: fake.email, historyId: 1 }));
      expect(response.status).toBe(204);
      await flushAfter();
      expect(await storedIds(accountId)).toEqual([fresh]);

      expect((await push(pushRequest("?token=push-secret", "not-base64-json"))).status).toBe(204);
      expect((await push(pushRequest("?token=push-secret", { historyId: 5 }))).status).toBe(204);
      expect(pending).toHaveLength(0);
    });

    it("verifies the Pub/Sub OIDC token when an audience is configured", async () => {
      process.env.PUBSUB_VERIFICATION_TOKEN = "push-secret";
      process.env.PUBSUB_AUDIENCE = AUDIENCE;
      process.env.PUBSUB_SERVICE_ACCOUNT = "push@p.iam.gserviceaccount.com";
      const payload = { emailAddress: "unknown@example.com", historyId: 1 };
      const good = await keys.sign!({ aud: AUDIENCE, email: "push@p.iam.gserviceaccount.com", email_verified: true });
      const wrongAccount = await keys.sign!({ aud: AUDIENCE, email: "evil@x.iam.gserviceaccount.com", email_verified: true });
      const wrongAudience = await keys.sign!({ aud: "https://other", email: "push@p.iam.gserviceaccount.com", email_verified: true });

      expect((await push(pushRequest("?token=push-secret", payload))).status).toBe(401);
      expect((await push(pushRequest("?token=push-secret", payload, { authorization: "Bearer garbage" }))).status).toBe(401);
      expect((await push(pushRequest("?token=push-secret", payload, { authorization: `Bearer ${wrongAccount}` }))).status).toBe(401);
      expect((await push(pushRequest("?token=push-secret", payload, { authorization: `Bearer ${wrongAudience}` }))).status).toBe(401);
      expect((await push(pushRequest("?token=push-secret", payload, { authorization: `Bearer ${good}` }))).status).toBe(204);
      await flushAfter();
    });
  });

  describe("OAuth connect / callback", () => {
    it("connect requires a session and sets a one-time state cookie", async () => {
      const anonymous = await connect(new Request("http://localhost:3000/api/google/connect"));
      expect(anonymous.status).toBe(307);
      expect(anonymous.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fsettings");

      const response = await connect(
        new Request("http://localhost:3000/api/google/connect?login_hint=me@example.com", { headers: { cookie: session } }),
      );
      const location = new URL(response.headers.get("location")!);
      expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(location.searchParams.get("login_hint")).toBe("me@example.com");
      const setCookie = response.headers.get("set-cookie")!;
      expect(setCookie).toContain(`oauth_state=${location.searchParams.get("state")}`);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/Path=\/api\/google/);
      expect(setCookie).toMatch(/Max-Age=600/);
      expect(setCookie).toMatch(/SameSite=lax/i);
    });

    const callbackRequest = (query: string, cookie = `${session}; oauth_state=the-state`) =>
      new Request(`http://localhost:3000/api/google/callback${query}`, { headers: { cookie } });

    it("rejects a missing or mismatched state and passes Google's error through", async () => {
      const mismatch = await callback(callbackRequest("?code=good-code&state=other"));
      expect(mismatch.headers.get("location")).toBe("http://localhost:3000/settings?error=state");
      expect(mismatch.headers.get("set-cookie")).toMatch(/oauth_state=;.*Max-Age=0/i);
      const noCookie = await callback(callbackRequest("?code=good-code&state=the-state", session));
      expect(noCookie.headers.get("location")).toBe("http://localhost:3000/settings?error=state");
      const denied = await callback(callbackRequest("?error=access_denied&state=the-state"));
      expect(denied.headers.get("location")).toBe("http://localhost:3000/settings?error=access_denied");
      const anonymous = await callback(callbackRequest("?code=good-code&state=the-state", "oauth_state=the-state"));
      expect(anonymous.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fsettings");
      fake.scope = "openid email";
      const scopes = await callback(callbackRequest("?code=good-code&state=the-state"));
      expect(scopes.headers.get("location")).toBe("http://localhost:3000/settings?error=scopes");
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from gmail_accounts`;
      expect(n).toBe(0);
      expect(fake.tokenRequests.length).toBe(1);
    });

    it("connects an account, imports in after(), and a reconnect keeps cursor and refresh token", async () => {
      fake.addMany(3);
      fake.sendAs = [
        { sendAsEmail: fake.email, isPrimary: true, displayName: "Me Myself" },
        { sendAsEmail: "alias@example.com", verificationStatus: "accepted" },
      ];
      const response = await callback(callbackRequest("?code=good-code&state=the-state"));
      expect(response.headers.get("location")).toBe("http://localhost:3000/settings?connected=me%40example.com");
      expect(response.headers.get("set-cookie")).toMatch(/oauth_state=;.*Max-Age=0/i);
      await flushAfter();

      const [account] = await sql<{ id: string }[]>`select id from gmail_accounts where email = ${fake.email}`;
      let row = await accountRow(account.id);
      expect(row).toMatchObject({ status: "active", backfillStatus: "done", aliases: ["alias@example.com"], historyId: String(fake.historyId) });
      expect(decryptSecret(row.refreshTokenEnc!)).toBe("refresh-from-code");
      expect(await storedIds(account.id)).toHaveLength(3);

      // Reconnect: Google omits the refresh token; the cursor stays, sync catches up.
      await sql`update gmail_accounts set status = 'reauth_required' where id = ${account.id}`;
      const cursor = row.historyId;
      const newer = fake.addMessage();
      fake.codeRefreshToken = null;
      fake.requests.length = 0;
      await callback(callbackRequest("?code=good-code&state=the-state"));
      await flushAfter();
      row = await accountRow(account.id);
      expect(row.status).toBe("active");
      expect(decryptSecret(row.refreshTokenEnc!)).toBe("refresh-from-code");
      expect(fake.requests.find((r) => r.path === "history")?.url).toContain(`startHistoryId=${cursor}`);
      expect(await storedIds(account.id)).toContain(newer);
    });
  });

  describe("POST /api/sync/[accountId]", () => {
    const params = (accountId: string) => ({ params: Promise.resolve({ accountId }) });

    it("requires the cron secret or a session", async () => {
      const accountId = await insertConnectedAccount(fake.email);
      const url = `http://localhost:3000/api/sync/${accountId}?mode=sync`;
      expect((await syncRoute(new Request(url, { method: "POST" }), params(accountId))).status).toBe(401);
      expect(
        (await syncRoute(new Request(url, { method: "POST", headers: { authorization: "Bearer nope" } }), params(accountId))).status,
      ).toBe(401);
      const bad = new Request(`http://localhost:3000/api/sync/${accountId}?mode=nope`, { method: "POST", headers: { cookie: session } });
      expect((await syncRoute(bad, params(accountId))).status).toBe(400);
      const missing = "00000000-0000-0000-0000-000000000000";
      const unknown = new Request(`http://localhost:3000/api/sync/${missing}`, { method: "POST", headers: { cookie: session } });
      expect((await syncRoute(unknown, params(missing))).status).toBe(404);
      expect(pending).toHaveLength(0);
    });

    it("accepts internal and session requests and runs the job in after()", async () => {
      fake.addMany(2);
      const accountId = await insertConnectedAccount(fake.email);
      const internal = new Request(`http://localhost:3000/api/sync/${accountId}?mode=backfill`, {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret", "x-crm-hop": "2" },
      });
      const response = await syncRoute(internal, params(accountId));
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ accepted: true, mode: "backfill" });
      await flushAfter();
      expect(await storedIds(accountId)).toHaveLength(2);

      const fresh = fake.addMessage();
      const bySession = new Request(`http://localhost:3000/api/sync/${accountId}?mode=sync`, { method: "POST", headers: { cookie: session } });
      expect((await syncRoute(bySession, params(accountId))).status).toBe(202);
      await flushAfter();
      expect(await storedIds(accountId)).toContain(fresh);
    });
  });

  describe("cron and accounts", () => {
    it("GET /api/cron/sync requires the cron secret", async () => {
      const accountId = await insertConnectedAccount(fake.email, { backfill_status: "done", last_synced_at: null });
      expect((await cron(new Request("http://localhost:3000/api/cron/sync"))).status).toBe(401);
      const response = await cron(new Request("http://localhost:3000/api/cron/sync", { headers: { authorization: "Bearer test-cron-secret" } }));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { accounts: { id: string; syncTriggered: boolean }[] };
      expect(body.accounts).toEqual([expect.objectContaining({ id: accountId, syncTriggered: true })]);
      expect(fake.appRequests.map((r) => r.url)).toEqual([`http://localhost:3000/api/sync/${accountId}?mode=sync`]);
    });

    it("GET /api/accounts requires a session and hides secrets", async () => {
      await insertConnectedAccount(fake.email);
      expect((await accounts(new Request("http://localhost:3000/api/accounts"))).status).toBe(401);
      const response = await accounts(new Request("http://localhost:3000/api/accounts", { headers: { cookie: session } }));
      const body = (await response.json()) as { accounts: Record<string, unknown>[]; databaseMb: number };
      expect(body.accounts).toHaveLength(1);
      expect(body.accounts[0]).toMatchObject({ email: fake.email, status: "active", backfillStalled: true });
      expect(body.accounts[0]).not.toHaveProperty("refreshTokenEnc");
      expect(body.databaseMb).toBeGreaterThan(0);
    });
  });
});
