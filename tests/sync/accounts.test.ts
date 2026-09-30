import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { GmailApiError } from "@/lib/gmail/client";
import {
  AccountAuthError,
  deleteAccount,
  disconnectAccount,
  getAccessToken,
  gmailClientFor,
  reconcileSelfContacts,
  recordAccountError,
  refreshAliases,
  upsertAccountFromOAuth,
} from "@/lib/sync/accounts";
import { ingestMessages } from "@/lib/sync/ingest";
import { ensureWatch, stopWatch } from "@/lib/sync/watch";
import { useTestDatabase } from "../setup/db";
import { FakeGmail } from "../helpers/fake-gmail";
import { accountRow, addr, contactByEmail, insertConnectedAccount, MODIFY_SCOPES, parsed, useFastGmailClients } from "../helpers/sync";

const tokens = (overrides: Partial<Parameters<typeof upsertAccountFromOAuth>[0]["tokens"]> = {}) => ({
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: new Date(Date.now() + 3_600_000),
  scopes: MODIFY_SCOPES,
  idToken: null,
  ...overrides,
});

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("accounts", () => {
  useTestDatabase();
  useFastGmailClients();
  afterEach(() => {
    delete process.env.GMAIL_PUBSUB_TOPIC;
  });

  it("creates an account from OAuth and keeps cursor and refresh token on reconnect", async () => {
    const first = await upsertAccountFromOAuth({
      email: "Me@Example.com",
      displayName: "Me",
      tokens: tokens(),
      historyId: "5000",
      messagesTotal: 1234,
      aliases: ["alias@example.com", "me@example.com"],
    });
    expect(first.created).toBe(true);
    expect(first.account).toMatchObject({
      email: "me@example.com",
      historyId: "5000",
      backfillStatus: "pending",
      backfillQuery: "-in:chats -in:drafts",
      backfillEstimate: 1234,
      aliases: ["alias@example.com"],
      status: "active",
    });
    expect(decryptSecret(first.account.refreshTokenEnc!)).toBe("refresh-1");
    expect("created" in first.account).toBe(false);

    await sql`
      update gmail_accounts set history_id = 6000, status = 'reauth_required', last_error = 'x',
             backfill_status = 'error' where id = ${first.account.id}
    `;
    const again = await upsertAccountFromOAuth({
      email: "me@example.com",
      displayName: null,
      tokens: tokens({ accessToken: "access-2", refreshToken: null }),
      historyId: "9000",
      messagesTotal: 1300,
      aliases: [],
    });
    expect(again.created).toBe(false);
    expect(again.account).toMatchObject({
      id: first.account.id,
      historyId: "6000",
      status: "active",
      lastError: null,
      backfillStatus: "pending",
      displayName: "Me",
      aliases: ["alias@example.com"],
    });
    expect(decryptSecret(again.account.refreshTokenEnc!)).toBe("refresh-1");
    expect(decryptSecret(again.account.accessTokenEnc!)).toBe("access-2");
  });

  it("caches access tokens, refreshes near expiry and flags revoked grants", async () => {
    const fake = new FakeGmail();
    const id = await insertConnectedAccount(fake.email, {
      access_token_enc: encryptSecret("cached"),
      access_token_expires_at: new Date(Date.now() + 30_000),
    });
    const fresh = await getAccessToken(id, false, fake.fetch);
    expect(fresh).toBe("fresh-1");
    expect(fake.tokenRequests[0].get("refresh_token")).toBe("refresh-token");
    expect(await getAccessToken(id, false, fake.fetch)).toBe("fresh-1");
    expect(fake.tokenRequests).toHaveLength(1);
    expect(await getAccessToken(id, true, fake.fetch)).toBe("fresh-2");

    // A client reads the token once and reuses it.
    const client = gmailClientFor(id, fake.fetch);
    await Promise.all([client.getProfile(), client.getProfile(), client.getProfile()]);
    expect(fake.tokenRequests).toHaveLength(2);

    fake.refreshError = "invalid_grant";
    await expect(getAccessToken(id, true, fake.fetch)).rejects.toBeInstanceOf(AccountAuthError);
    const row = await accountRow(id);
    expect(row.status).toBe("reauth_required");
    expect(row.lastError).toMatch(/revoked or has expired: reconnect it in Settings/);
    expect(row.accessTokenEnc).toBeNull();
    await expect(getAccessToken(id, false, fake.fetch)).rejects.toThrow(/Reconnect me@example.com/);
  });

  it("stores verified aliases and removes own addresses from contacts", async () => {
    const fake = new FakeGmail();
    fake.sendAs = [
      { sendAsEmail: "me@example.com", isPrimary: true },
      { sendAsEmail: "Alias@Example.com", verificationStatus: "accepted" },
      { sendAsEmail: "pending@example.com", verificationStatus: "pending" },
    ];
    const id = await insertConnectedAccount(fake.email);

    // Contacts that exist before the alias is known.
    const [auto] = await sql<{ id: string }[]>`insert into contacts (name, source) values ('Alias', 'gmail') returning id`;
    await sql`insert into contact_emails (email, contact_id, is_primary) values ('alias@example.com', ${auto.id}, true)`;
    const [manual] = await sql<{ id: string }[]>`insert into contacts (name, source) values ('Both', 'manual') returning id`;
    await sql`
      insert into contact_emails (email, contact_id, is_primary, created_at) values
        ('pending@example.com', ${manual.id}, true, now() - interval '1 day'),
        ('real@x.org', ${manual.id}, false, now())
    `;

    await refreshAliases(id, { fetchImpl: fake.fetch });
    expect((await accountRow(id)).aliases).toEqual(["alias@example.com"]);
    await sql`update gmail_accounts set aliases = '{alias@example.com,pending@example.com}' where id = ${id}`;

    expect(await reconcileSelfContacts()).toBe(2);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from contacts where id = ${auto.id}`;
    expect(n).toBe(0);
    const [primary] = await sql<{ email: string; isPrimary: boolean }[]>`
      select email, is_primary from contact_emails where contact_id = ${manual.id}
    `;
    expect(primary).toEqual({ email: "real@x.org", isPrimary: true });
    expect(await reconcileSelfContacts()).toBe(0);
  });

  it("records short errors", async () => {
    const id = await insertConnectedAccount("me@example.com");
    await recordAccountError(id, new GmailApiError(403, "Insufficient Permission", "insufficientPermissions"));
    expect((await accountRow(id)).lastError).toBe("Gmail API error 403: Insufficient Permission");
    await recordAccountError(id, new Error("x".repeat(2000)));
    expect((await accountRow(id)).lastError).toHaveLength(500);
  });

  it("disconnects (keeps mail) and deletes (drops mail, refreshes contacts)", async () => {
    const fake = new FakeGmail();
    const id = await insertConnectedAccount(fake.email, { watch_expires_at: new Date(Date.now() + 86_400_000) });
    await ingestMessages(id, [parsed({ from: addr("friend@x.org") })], new Set([fake.email]));

    await disconnectAccount(id, { fetchImpl: fake.fetch });
    expect(fake.stopCalls).toBe(1);
    expect(fake.revoked).toEqual(["refresh-token"]);
    const row = await accountRow(id);
    expect(row).toMatchObject({ status: "disconnected", refreshTokenEnc: null, accessTokenEnc: null, watchExpiresAt: null });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from messages where account_id = ${id}`;
    expect(n).toBe(1);

    expect((await contactByEmail("friend@x.org"))?.messageCount).toBe(1);
    await deleteAccount(id, { fetchImpl: fake.fetch });
    expect(await accountRow(id)).toBeUndefined();
    expect((await contactByEmail("friend@x.org"))?.messageCount).toBe(0);
  });
});

describe.skipIf(process.env.SKIP_DB_TESTS === "1")("watch", () => {
  useTestDatabase();
  useFastGmailClients();
  afterEach(() => {
    delete process.env.GMAIL_PUBSUB_TOPIC;
  });

  it("does nothing without a topic", async () => {
    const fake = new FakeGmail();
    const id = await insertConnectedAccount(fake.email);
    expect(await ensureWatch(id, { fetchImpl: fake.fetch })).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  it("watches the whole mailbox and never moves the cursor", async () => {
    process.env.GMAIL_PUBSUB_TOPIC = "projects/p/topics/gmail";
    const fake = new FakeGmail();
    fake.addMany(3);
    const id = await insertConnectedAccount(fake.email, { history_id: 7 });
    expect(await ensureWatch(id, { fetchImpl: fake.fetch })).toBe(true);
    expect(fake.watchCalls).toEqual([{ topicName: "projects/p/topics/gmail" }]);
    let row = await accountRow(id);
    expect(row.historyId).toBe("7");
    expect(row.watchExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    const unset = await insertConnectedAccount("two@example.com", { history_id: null });
    await ensureWatch(unset, { fetchImpl: fake.fetch });
    expect((await accountRow(unset)).historyId).toBe(String(fake.historyId));

    fake.failNext(/^watch$/, 403, { message: "User not authorized to perform this action." });
    expect(await ensureWatch(id, { fetchImpl: fake.fetch })).toBe(false);
    row = await accountRow(id);
    expect(row.lastError).toBe("Live sync unavailable: Gmail API error 403: User not authorized to perform this action.");
    expect(await ensureWatch(id, { fetchImpl: fake.fetch })).toBe(true);
    expect((await accountRow(id)).lastError).toBeNull();

    await stopWatch(id, { fetchImpl: fake.fetch });
    expect(fake.stopCalls).toBe(1);
    expect((await accountRow(id)).watchExpiresAt).toBeNull();
  });
});
