import { beforeAll, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { sql } from "@/lib/db";
import type { Address } from "@/lib/types";
import type { ParsedMessage } from "@/lib/gmail/types";
import { setGmailClientDefaults } from "@/lib/sync/accounts";
import { insertAccount } from "../setup/db";

export const MODIFY_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.modify"];

/** No pacing and no backoff for every GmailClient built by lib/sync in this test file. */
export function useFastGmailClients(): void {
  beforeAll(() => {
    setGmailClientDefaults({ maxRequestsPerSecond: Infinity, retryBaseMs: 0 });
  });
}

/**
 * A connected, active account with encrypted tokens and a cached access token
 * valid for an hour (so no token refresh happens unless a test wants one).
 */
export async function insertConnectedAccount(email: string, extra: Record<string, unknown> = {}): Promise<string> {
  return insertAccount(email, {
    status: "active",
    scopes: MODIFY_SCOPES,
    refresh_token_enc: encryptSecret("refresh-token"),
    access_token_enc: encryptSecret("access-token"),
    access_token_expires_at: new Date(Date.now() + 3_600_000),
    history_id: 1000,
    ...extra,
  });
}

export async function accountRow(id: string) {
  const [row] = await sql<
    {
      historyId: string | null;
      backfillStatus: string;
      backfillPageToken: string | null;
      backfillQuery: string | null;
      backfillScanned: number;
      backfillImported: number;
      backfillEstimate: number | null;
      backfillLockedUntil: Date | null;
      syncLockedUntil: Date | null;
      syncRequested: boolean;
      lastSyncedAt: Date | null;
      lastError: string | null;
      status: string;
      watchExpiresAt: Date | null;
      aliases: string[];
      scopes: string[];
      refreshTokenEnc: string | null;
      accessTokenEnc: string | null;
    }[]
  >`select * from gmail_accounts where id = ${id}`;
  return row;
}

export async function storedMessages(accountId: string) {
  return sql<{ gmailMessageId: string; labelIds: string[]; isAutomated: boolean; automatedReason: string | null; subject: string | null }[]>`
    select gmail_message_id, label_ids, is_automated, automated_reason, subject
      from messages where account_id = ${accountId} order by gmail_message_id
  `;
}

export async function storedIds(accountId: string): Promise<string[]> {
  return (await storedMessages(accountId)).map((m) => m.gmailMessageId);
}

export async function contactByEmail(email: string) {
  const [row] = await sql<
    {
      id: string;
      name: string | null;
      status: string;
      source: string;
      organizationId: string | null;
      lastInboundAt: Date | null;
      lastOutboundAt: Date | null;
      lastContactedAt: Date | null;
      awaitingReplySince: Date | null;
      messageCount: number;
    }[]
  >`
    select c.* from contacts c join contact_emails ce on ce.contact_id = c.id where ce.email = ${email}
  `;
  return row ?? null;
}

/**
 * Date.now() with a movable offset, for deadline tests: `jump(ms)` moves the
 * clock forward. Restore with vi.restoreAllMocks().
 */
export function testClock() {
  const real = Date.now.bind(Date);
  let offset = 0;
  vi.spyOn(Date, "now").mockImplementation(() => real() + offset);
  return {
    jump(ms: number) {
      offset += ms;
    },
  };
}

let seq = 0;
const addr = (email: string, name: string | null = null): Address => ({ email, name });

/** A ParsedMessage with sensible defaults (inbound, not automated). */
export function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  seq++;
  const id = overrides.gmailMessageId ?? `p${String(seq).padStart(6, "0")}`;
  return {
    gmailMessageId: id,
    gmailThreadId: `t-${id}`,
    labelIds: ["INBOX"],
    rfc822MessageId: `<${id}@test>`,
    inReplyTo: null,
    references: null,
    direction: "inbound",
    from: addr("jane@example.org", "Jane Doe"),
    to: [addr("me@example.com")],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: `Subject ${id}`,
    snippet: "snippet",
    bodyText: "body",
    sentAt: new Date(Date.now() - 60_000),
    isAutomated: false,
    automatedReason: null,
    hasAttachments: false,
    attachments: [],
    ...overrides,
  };
}

export { addr };
