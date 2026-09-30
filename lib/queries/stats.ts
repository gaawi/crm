import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

export interface OverviewCounts {
  accounts: number;
  /** Accounts that need the owner to reconnect. */
  accountsNeedingReauth: number;
  /** Accounts whose first import is still running. */
  importing: number;
  contacts: number;
  /** Auto-created contacts not reviewed yet (status new). */
  newContacts: number;
  messages: number;
}

export async function getOverviewCounts(): Promise<OverviewCounts> {
  const [row] = await sql<OverviewCounts[]>`
    select
      (select count(*)::int from gmail_accounts where status <> 'disconnected') as accounts,
      (select count(*)::int from gmail_accounts where status = 'reauth_required') as accounts_needing_reauth,
      (select count(*)::int from gmail_accounts
        where status = 'active' and backfill_status in ('pending', 'running')) as importing,
      (select count(*)::int from contacts where status <> 'archived') as contacts,
      (select count(*)::int from contacts where status = 'new') as new_contacts,
      (select count(*)::int from messages) as messages
  `;
  return row;
}

/** Every address that is "me": connected accounts, their send-as aliases, and OWN_EMAILS. */
export async function getOwnAddresses(): Promise<Set<string>> {
  const rows = await sql<{ email: string }[]>`
    select lower(email) as email from gmail_accounts
    union
    select lower(unnest(aliases)) from gmail_accounts
  `;
  return new Set([...rows.map((r) => r.email), ...env.ownEmails]);
}
