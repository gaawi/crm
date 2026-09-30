import "server-only";
import { sql, type Tx } from "@/lib/db";
import { FREE_MAIL_DOMAINS } from "@/lib/constants";
import type { ParsedMessage } from "@/lib/gmail/types";
import { participantRows, selectContactCandidates } from "@/lib/sync/rules";
import { domainOf, errorMessage, truncate } from "@/lib/utils";

export interface IngestResult {
  /** Rows inserted or updated. */
  stored: number;
  /** Rows newly inserted (subset of stored). */
  inserted: number;
  contactsCreated: number;
  /** Contacts whose stats were refreshed. */
  contactIds: string[];
  /** Messages that could not be stored; the rest of the batch was. */
  failed: { gmailMessageId: string; error: string }[];
}

/** Pseudo-label added to stored messages that were permanently deleted in Gmail. */
export const DELETED_LABEL = "DELETED";

const MAX_FAILURE_CHARS = 300;

/**
 * Store a batch of parsed messages for one account, in one transaction:
 * 1. each message inside its own savepoint (one bad message never aborts the
 *    batch): insert, or on (account_id, gmail_message_id) conflict refresh
 *    label_ids only (content is immutable); message_participants rows are
 *    inserted for newly inserted messages only; failures are collected;
 * 2. create contacts for unknown candidate addresses (rules.selectContactCandidates)
 *    of the inserted messages, under pg_advisory_xact_lock so concurrent runs
 *    never duplicate a contact; link each new contact to the organization whose
 *    domains contain its domain (never for FREE_MAIL_DOMAINS); fill empty names
 *    of existing contacts from display names;
 * 3. add every candidate's contact to the account's default project, if any;
 * 4. refresh_contact_stats for every contact owning any participant address.
 */
export async function ingestMessages(
  accountId: string,
  messages: ParsedMessage[],
  selfEmails: ReadonlySet<string>,
): Promise<IngestResult> {
  const result: IngestResult = { stored: 0, inserted: 0, contactsCreated: 0, contactIds: [], failed: [] };
  if (messages.length === 0) return result;

  // A stable order means concurrent ingests of overlapping batches wait for
  // each other on the unique index instead of deadlocking.
  const unique = new Map<string, ParsedMessage>();
  for (const message of messages) unique.set(String(message?.gmailMessageId ?? ""), message);
  const ordered = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return sql.begin(async (tx) => {
    const participantEmails = new Set<string>();
    const candidates = new Map<string, string | null>();

    for (const [gmailMessageId, message] of ordered) {
      try {
        if (!gmailMessageId) throw new Error("message has no Gmail id");
        const participants = participantRows(message);
        const row = await tx.savepoint(async (sp) => {
          const [upserted] = await sp<{ id: string; inserted: boolean }[]>`
            insert into messages (
              account_id, gmail_message_id, gmail_thread_id, rfc822_message_id, in_reply_to, references_header,
              direction, from_email, from_name, subject, snippet, body_text, sent_at, label_ids,
              is_automated, automated_reason, has_attachments, attachments
            ) values (
              ${accountId}, ${gmailMessageId}, ${message.gmailThreadId || gmailMessageId}, ${message.rfc822MessageId},
              ${message.inReplyTo}, ${message.references}, ${message.direction}, ${message.from?.email ?? null},
              ${message.from?.name ?? null}, ${message.subject}, ${message.snippet}, ${message.bodyText},
              ${message.sentAt}, ${message.labelIds ?? []}::text[], ${message.isAutomated},
              ${message.isAutomated ? (message.automatedReason ?? null) : null}, ${message.hasAttachments},
              ${JSON.stringify(message.attachments ?? [])}::jsonb
            )
            on conflict (account_id, gmail_message_id) do update
               set label_ids = excluded.label_ids
             where messages.label_ids is distinct from excluded.label_ids
            returning id, (xmax = 0) as inserted
          `;
          if (upserted?.inserted && participants.length > 0) {
            await sp`
              insert into message_participants ${sp(
                participants.map((p) => ({ message_id: upserted.id, role: p.role, email: p.email, name: p.name })),
              )}
              on conflict do nothing
            `;
          }
          return upserted ?? null;
        });
        if (!row) continue;
        result.stored++;
        if (!row.inserted) continue;
        result.inserted++;
        for (const p of participants) participantEmails.add(p.email);
        for (const candidate of selectContactCandidates(message, selfEmails)) {
          if (!candidates.has(candidate.email) || (candidates.get(candidate.email) === null && candidate.name)) {
            candidates.set(candidate.email, candidate.name);
          }
        }
      } catch (error) {
        result.failed.push({
          gmailMessageId: gmailMessageId || "(missing id)",
          error: truncate(errorMessage(error).replace(/\s+/g, " "), MAX_FAILURE_CHARS),
        });
      }
    }

    let candidateContactIds: string[] = [];
    if (candidates.size > 0) {
      const emails = [...candidates.keys()];
      const names = emails.map((email) => candidates.get(email) ?? null);
      const domains = emails.map((email) => {
        const domain = domainOf(email);
        return domain && !FREE_MAIL_DOMAINS.has(domain) ? domain : null;
      });

      await tx`select pg_advisory_xact_lock(hashtext('crm:contact-create'))`;

      const created = await tx<{ contactId: string }[]>`
        with input as (
          select * from unnest(${emails}::text[], ${names}::text[], ${domains}::text[]) as t(email, name, domain)
        ),
        fresh as materialized (
          select gen_random_uuid() as id, i.email, i.name, i.domain
            from input i
           where not exists (select 1 from contact_emails ce where ce.email = i.email)
             and not exists (select 1 from self_addresses s where s.email = i.email)
        ),
        new_contacts as (
          insert into contacts (id, name, status, source, organization_id)
          select f.id, f.name, 'new', 'gmail',
                 (select o.id from organizations o
                   where f.domain is not null and f.domain = any (o.domains)
                   order by o.created_at, o.id limit 1)
            from fresh f
          returning id
        )
        insert into contact_emails (email, contact_id, is_primary)
        select f.email, f.id, true from fresh f join new_contacts n on n.id = f.id
        returning contact_id
      `;
      result.contactsCreated = created.length;

      await tx`
        update contacts c set name = i.name
          from unnest(${emails}::text[], ${names}::text[]) as i(email, name)
          join contact_emails ce on ce.email = i.email
         where c.id = ce.contact_id
           and i.name is not null
           and (c.name is null or btrim(c.name) = '')
      `;

      const owners = await tx<{ contactId: string }[]>`
        select distinct contact_id from contact_emails where email = any(${emails}::text[])
      `;
      candidateContactIds = owners.map((r) => r.contactId);

      if (candidateContactIds.length > 0) {
        await tx`
          insert into contact_projects (contact_id, project_id)
          select c.id, a.default_project_id
            from gmail_accounts a, unnest(${candidateContactIds}::uuid[]) as c(id)
           where a.id = ${accountId} and a.default_project_id is not null
          on conflict do nothing
        `;
      }
    }

    const statEmails = [...new Set([...participantEmails, ...candidates.keys()])];
    if (statEmails.length > 0) {
      const owners = await tx<{ contactId: string }[]>`
        select distinct contact_id from contact_emails where email = any(${statEmails}::text[])
      `;
      result.contactIds = [...new Set([...owners.map((r) => r.contactId), ...candidateContactIds])];
      if (result.contactIds.length > 0) {
        await tx`select refresh_contact_stats(${result.contactIds}::uuid[])`;
      }
    }
    return result;
  });
}

/** Contacts owning a participant address of these stored messages. */
async function affectedContacts(
  tx: Tx,
  accountId: string,
  gmailMessageIds: string[],
): Promise<string[]> {
  const rows = await tx<{ contactId: string }[]>`
    select distinct ce.contact_id
      from messages m
      join message_participants mp on mp.message_id = m.id
      join contact_emails ce on ce.email = mp.email
     where m.account_id = ${accountId} and m.gmail_message_id = any(${gmailMessageIds}::text[])
  `;
  return rows.map((r) => r.contactId);
}

/** Delete by Gmail id (spam) and refresh stats of affected contacts. Returns rows deleted. */
export async function deleteMessages(accountId: string, gmailMessageIds: string[]): Promise<number> {
  const ids = [...new Set(gmailMessageIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  return sql.begin(async (tx) => {
    // Participants cascade-delete, so collect the contacts first.
    const contactIds = await affectedContacts(tx, accountId, ids);
    const deleted = await tx`
      delete from messages where account_id = ${accountId} and gmail_message_id = any(${ids}::text[]) returning id
    `;
    if (contactIds.length > 0) await tx`select refresh_contact_stats(${contactIds}::uuid[])`;
    return deleted.length;
  });
}

/** Which of these Gmail ids are already stored for the account. */
export async function existingMessageIds(accountId: string, gmailMessageIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(gmailMessageIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const rows = await sql<{ gmailMessageId: string }[]>`
    select gmail_message_id from messages where account_id = ${accountId} and gmail_message_id = any(${ids}::text[])
  `;
  return new Set(rows.map((r) => r.gmailMessageId));
}

/**
 * Label-only updates for stored messages (archive, read/unread, star, trash…).
 * No fetch and no stats refresh: stats do not depend on labels. Unknown ids
 * are ignored. Returns rows changed.
 */
export async function updateMessageLabels(
  accountId: string,
  changes: { gmailMessageId: string; labelIds: string[] }[],
): Promise<number> {
  const latest = new Map<string, string[]>();
  for (const change of changes) {
    if (change?.gmailMessageId && Array.isArray(change.labelIds)) latest.set(change.gmailMessageId, change.labelIds);
  }
  if (latest.size === 0) return 0;
  const payload = JSON.stringify([...latest].map(([g, l]) => ({ g, l })));
  const rows = await sql`
    update messages m
       set label_ids = c.l
      from jsonb_to_recordset(${payload}::jsonb) as c(g text, l text[])
     where m.account_id = ${accountId}
       and m.gmail_message_id = c.g
       and m.label_ids is distinct from c.l
    returning m.id
  `;
  return rows.length;
}

/** Permanently deleted in Gmail: keep the message, add the DELETED pseudo-label. Returns rows changed. */
export async function markMessagesDeleted(accountId: string, gmailMessageIds: string[]): Promise<number> {
  const ids = [...new Set(gmailMessageIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const rows = await sql`
    update messages
       set label_ids = array_append(label_ids, ${DELETED_LABEL}::text)
     where account_id = ${accountId}
       and gmail_message_id = any(${ids}::text[])
       and not (${DELETED_LABEL}::text = any(label_ids))
    returning id
  `;
  return rows.length;
}
