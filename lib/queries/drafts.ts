import "server-only";
import { sql } from "@/lib/db";
import type { DraftOrigin, DraftPurpose, DraftStatus, EmailDraft } from "@/lib/types";
import { clampLimit } from "@/lib/queries/shared";

/**
 * The approval queue (email_drafts). This module only reads and writes rows;
 * Gmail side effects (saving/updating/sending the Gmail draft) live in
 * lib/sync/drafts.ts and the orchestration in lib/ai/approvals.ts.
 */

const draftColumns = () => sql`
  d.id, d.account_id, a.email as account_email,
  case when c.id is null then null else json_build_object(
    'id', c.id,
    'displayName', coalesce(nullif(btrim(c.name), ''),
      (select ce.email from contact_emails ce where ce.contact_id = c.id order by ce.is_primary desc, ce.created_at limit 1),
      'Unknown')
  ) end as contact,
  d.opportunity_id, d.reply_to_message_id, rm.subject as reply_to_subject,
  d.purpose, d.origin, d.status,
  d.to_emails as "to", d.cc_emails as cc, d.subject, d.body_text as body, d.rationale, d.revisions,
  d.gmail_draft_id, d.gmail_thread_id, d.error, d.created_at, d.updated_at, d.sent_at
`;

const draftJoins = () => sql`
  join gmail_accounts a on a.id = d.account_id
  left join contacts c on c.id = d.contact_id
  left join messages rm on rm.id = d.reply_to_message_id
`;

/** Open proposals first (newest first), or a given set of statuses. */
export async function listDrafts(options: { statuses?: DraftStatus[]; contactId?: string; limit?: number } = {}): Promise<EmailDraft[]> {
  const statuses = options.statuses ?? ["proposed", "revising", "sending", "failed"];
  return sql<EmailDraft[]>`
    select ${draftColumns()}
      from email_drafts d
      ${draftJoins()}
     where d.status = any(${statuses}::text[])
       ${options.contactId ? sql`and d.contact_id = ${options.contactId}` : sql``}
     order by (d.status = 'failed') desc, d.created_at desc
     limit ${clampLimit(options.limit, 100, 500)}
  `;
}

export async function getDraft(id: string): Promise<EmailDraft | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<EmailDraft[]>`select ${draftColumns()} from email_drafts d ${draftJoins()} where d.id = ${id}`;
  return row ?? null;
}

/** Number of emails waiting for approval (tab badge). */
export async function countPendingDrafts(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from email_drafts where status in ('proposed', 'failed')
  `;
  return row.count;
}

export interface NewDraft {
  accountId: string;
  contactId?: string | null;
  opportunityId?: string | null;
  replyToMessageId?: string | null;
  purpose?: DraftPurpose;
  origin?: DraftOrigin;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  rationale?: string | null;
  gmailDraftId?: string | null;
  gmailThreadId?: string | null;
}

/** Insert a proposal. Returns null when the autopilot already has an open proposal for the contact. */
export async function insertDraft(input: NewDraft): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    insert into email_drafts ${sql({
      accountId: input.accountId,
      contactId: input.contactId ?? null,
      opportunityId: input.opportunityId ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      purpose: input.purpose ?? "follow_up",
      origin: input.origin ?? "assistant",
      toEmails: input.to,
      ccEmails: input.cc ?? [],
      subject: input.subject,
      bodyText: input.body,
      rationale: input.rationale ?? null,
      gmailDraftId: input.gmailDraftId ?? null,
      gmailThreadId: input.gmailThreadId ?? null,
    })}
    on conflict do nothing
    returning id
  `;
  return rows[0]?.id ?? null;
}

export interface DraftPatch {
  status?: DraftStatus;
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  rationale?: string | null;
  gmailDraftId?: string | null;
  gmailThreadId?: string | null;
  sentGmailMessageId?: string | null;
  error?: string | null;
  sentAt?: Date | null;
}

export async function updateDraft(id: string, patch: DraftPatch): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.to !== undefined) values.toEmails = patch.to;
  if (patch.cc !== undefined) values.ccEmails = patch.cc;
  if (patch.subject !== undefined) values.subject = patch.subject;
  if (patch.body !== undefined) values.bodyText = patch.body;
  if ("rationale" in patch) values.rationale = patch.rationale ?? null;
  if ("gmailDraftId" in patch) values.gmailDraftId = patch.gmailDraftId ?? null;
  if ("gmailThreadId" in patch) values.gmailThreadId = patch.gmailThreadId ?? null;
  if ("sentGmailMessageId" in patch) values.sentGmailMessageId = patch.sentGmailMessageId ?? null;
  if ("error" in patch) values.error = patch.error ?? null;
  if ("sentAt" in patch) values.sentAt = patch.sentAt ?? null;
  if (!Object.keys(values).length) return;
  await sql`update email_drafts set ${sql(values as never)} where id = ${id}`;
}

/** Record the current version before a revision, with the owner's note. */
export async function pushRevision(id: string, note: string | null): Promise<void> {
  await sql`
    update email_drafts
       set revisions = revisions || jsonb_build_array(jsonb_build_object(
             'at', now(), 'note', ${note}::text, 'subject', subject, 'body', body_text))
     where id = ${id}
  `;
}

/**
 * Atomically move a draft from one of `from` statuses to `to` (prevents double
 * sends from two taps). Returns false when the draft was not in `from`.
 */
export async function transitionDraft(id: string, from: DraftStatus[], to: DraftStatus): Promise<boolean> {
  const result = await sql`update email_drafts set status = ${to} where id = ${id} and status = any(${from}::text[])`;
  return result.count === 1;
}

/**
 * Rows left in 'revising' or 'sending' by an interrupted request (the
 * function was killed) are released after 10 minutes — well above the 300 s
 * function limit, so a live operation is never touched. An interrupted send
 * is never retried automatically: Approve re-checks the Gmail draft first.
 */
export async function recoverStaleDrafts(): Promise<void> {
  await sql`
    update email_drafts
       set status = case status when 'revising' then 'proposed' else 'failed' end,
           error = case status
                     when 'revising' then 'The revision was interrupted. Try again.'
                     else 'Sending was interrupted. Check your Sent folder before approving again.'
                   end
     where status in ('revising', 'sending') and updated_at < now() - interval '10 minutes'
  `;
}
