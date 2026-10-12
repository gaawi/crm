import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { DraftError, proposeEmail } from "@/lib/ai/approvals";
import { applyDraftRevision } from "@/lib/assistant/drafts";
import { ASSISTANT_ACTION_KINDS, MAX_EMAILS_PER_CALL } from "@/lib/assistant/types";
import { OPEN_DRAFT_STATUSES } from "@/lib/queries/assistant";
import { cleanHeaderText, replySubject } from "@/lib/gmail/mime";
import { noEmDash } from "@/lib/text/no-em-dash";
import { errorMessage } from "@/lib/utils";

/**
 * What the daily routine writes back (POST /api/assistant-agent/proposals).
 * Emails become proposals in the approval queue (never sent here), each with
 * an 'email' action; other actions are recommendations; revisions answer the
 * owner's "Request changes".
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const priority = z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2);

export const proposalsSchema = z.object({
  projectId: z.guid(),
  emails: z
    .array(
      z.object({
        opportunityId: z.guid(),
        subject: text(300),
        body: text(20_000),
        reason: text(1000),
        priority,
        purpose: z.enum(["outreach", "follow_up"]).optional(),
      }),
    )
    .max(50)
    .default([]),
  actions: z
    .array(
      z.object({
        opportunityId: z.guid().nullish(),
        kind: z.enum(ASSISTANT_ACTION_KINDS as ["email", "call", "whatsapp", "task"]),
        title: text(200),
        reason: z.string().trim().max(1000).nullish(),
        priority,
      }),
    )
    .max(100)
    .default([]),
  revisions: z
    .array(
      z.object({
        draftId: z.guid(),
        subject: text(300),
        body: text(20_000),
        /** For the owner, shown on the card: what was researched or changed, or a question back. */
        noteToOwner: z.string().trim().max(2000).nullish(),
      }),
    )
    .max(50)
    .default([]),
});

export type ProposalsInput = z.input<typeof proposalsSchema>;

export interface ProposalsResult {
  ok: true;
  projectId: string;
  created: {
    emails: { opportunityId: string; draftId: string; actionId: string }[];
    actions: { actionId: string; opportunityId: string | null }[];
    revisions: { draftId: string }[];
  };
  skipped: { type: "email" | "action" | "revision"; ref: string | null; reason: string }[];
  /** Change requests of this campaign still without a new version after this call. */
  pendingRevisions: { draftId: string; revisionRequest: string | null }[];
}

export class ProposalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface RowInfo {
  id: string;
  title: string;
  stage: string;
  contactId: string | null;
  contactName: string | null;
  orgName: string | null;
}

/** "RE: Fwd: Hola  mundo" → "hola mundo": the subject a thread is known by (dashes of any kind alike). */
export function threadSubject(subject: string | null): string {
  let text = cleanHeaderText(subject).toLowerCase();
  for (;;) {
    const next = text.replace(/^(?:re|aw|réf|ref|sv|antw|rif|fwd?|fw|tr|wg)\s*(?:\[\d+\])?\s*:\s*/i, "");
    if (next === text) break;
    text = next;
  }
  // Any kind of dash counts the same: "Collaboration – ADAR" and "Collaboration - ADAR" are one thread.
  return text
    .replace(/[\u2010-\u2015\u2212-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The conversation an assistant email continues: the latest message with the
 * contact whose subject is the same once "Re:"/"Fwd:" are stripped. Mail of
 * the campaign's send account comes first (Gmail can only thread a reply in
 * its own mailbox); otherwise any account, and the reply then goes out from
 * that account when it can send (not monitor-only), so the thread stays one.
 */
async function threadToContinue(contactId: string, subject: string, sendAccountId: string | null): Promise<{ messageId: string; accountId: string | null; subject: string | null } | null> {
  const wanted = threadSubject(subject);
  if (!wanted) return null;
  const messages = await sql<{ id: string; subject: string | null; accountId: string; writable: boolean }[]>`
    select distinct on (m.sent_at, m.id) m.id, m.subject, m.account_id, (a.status = 'active' and not a.monitor_only) as writable
      from contact_emails ce
      join message_participants mp on mp.email = ce.email
      join messages m on m.id = mp.message_id
      join gmail_accounts a on a.id = m.account_id
     where ce.contact_id = ${contactId}
     order by m.sent_at desc, m.id
     limit 200`;
  const matching = messages.filter((m) => threadSubject(m.subject) === wanted);
  const own = matching.find((m) => m.accountId === sendAccountId);
  if (own) return { messageId: own.id, accountId: sendAccountId, subject: own.subject };
  const elsewhere = matching[0];
  if (!elsewhere) return null;
  return { messageId: elsewhere.id, accountId: elsewhere.writable ? elsewhere.accountId : sendAccountId, subject: elsewhere.subject };
}

export async function applyProposals(raw: unknown): Promise<ProposalsResult> {
  const parsed = proposalsSchema.safeParse(raw);
  if (!parsed.success) throw new ProposalError(`Invalid request: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, 400);
  const input = parsed.data;

  const [sheet] = await sql<{ id: string; active: boolean; archived: boolean; sendAccountId: string | null }[]>`
    select p.id, p.assistant_active as active, p.archived,
           (select a.id from gmail_accounts a where a.id = p.send_account_id and a.status = 'active' and not a.monitor_only) as send_account_id
      from projects p where p.id = ${input.projectId} and p.sheet`;
  if (!sheet) throw new ProposalError("Campaign not found.", 404);
  if (!sheet.active || sheet.archived) throw new ProposalError("The assistant is paused for this campaign.", 409);

  const ids = [...new Set([...input.emails.map((e) => e.opportunityId), ...input.actions.flatMap((a) => (a.opportunityId ? [a.opportunityId] : []))])];
  const rows = ids.length
    ? await sql<RowInfo[]>`
        select op.id, op.title, op.stage, op.contact_id, nullif(btrim(c.name), '') as contact_name, o.name as org_name
          from opportunities op
          left join contacts c on c.id = op.contact_id
          left join organizations o on o.id = op.organization_id
         where op.project_id = ${sheet.id} and op.id = any(${ids}::uuid[])`
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const result: ProposalsResult = { ok: true, projectId: sheet.id, created: { emails: [], actions: [], revisions: [] }, skipped: [], pendingRevisions: [] };

  // First, the new versions of emails the owner asked to change.
  for (const revision of input.revisions) {
    const [owned] = await sql<{ replySubject: string | null }[]>`
      select (select m.subject from messages m where m.id = d.reply_to_message_id) as reply_subject
        from email_drafts d
       where d.id = ${revision.draftId}
         and (exists (select 1 from assistant_actions aa where aa.draft_id = d.id and aa.project_id = ${sheet.id})
              or exists (select 1 from opportunities op where op.id = d.opportunity_id and op.project_id = ${sheet.id}))`;
    if (!owned) {
      result.skipped.push({ type: "revision", ref: revision.draftId, reason: "Not an email of this campaign." });
      continue;
    }
    try {
      // A reply keeps its thread's subject exactly (Gmail threads by subject too).
      const subject = owned.replySubject ? replySubject(owned.replySubject) || revision.subject : revision.subject;
      await applyDraftRevision(revision.draftId, { subject, body: revision.body });
      if (revision.noteToOwner) await sql`update email_drafts set assistant_reason = ${noEmDash(revision.noteToOwner)} where id = ${revision.draftId}`;
      result.created.revisions.push({ draftId: revision.draftId });
    } catch (e) {
      result.skipped.push({ type: "revision", ref: revision.draftId, reason: e instanceof DraftError ? e.message : errorMessage(e) });
    }
  }

  // The owner's change requests come before any new email.
  result.pendingRevisions = await sql<{ draftId: string; revisionRequest: string | null }[]>`
    select distinct d.id as draft_id, d.revision_request
      from email_drafts d
      left join opportunities op on op.id = d.opportunity_id
     where d.status = 'changes_requested'
       and (op.project_id = ${sheet.id} or exists (select 1 from assistant_actions aa where aa.draft_id = d.id and aa.project_id = ${sheet.id}))`;
  const blocked = result.pendingRevisions.length > 0;

  // Emails: at most MAX_EMAILS_PER_CALL new proposals, never a second one for a row or contact.
  const seen = new Set<string>();
  for (const email of input.emails) {
    const row = byId.get(email.opportunityId);
    if (!row) {
      result.skipped.push({ type: "email", ref: email.opportunityId, reason: "Not a row of this campaign." });
      continue;
    }
    if (blocked) {
      result.skipped.push({
        type: "email",
        ref: row.id,
        reason: `Answer the owner's change requests first (revisions[]): ${result.pendingRevisions.length} still waiting. No new email until they are done.`,
      });
      continue;
    }
    if (seen.has(row.id) || (row.contactId && seen.has(row.contactId))) {
      result.skipped.push({ type: "email", ref: row.id, reason: "Duplicate in this request." });
      continue;
    }
    if (result.created.emails.length >= MAX_EMAILS_PER_CALL) {
      result.skipped.push({ type: "email", ref: row.id, reason: `Limit of ${MAX_EMAILS_PER_CALL} emails per campaign per run.` });
      continue;
    }
    if (!row.contactId) {
      result.skipped.push({ type: "email", ref: row.id, reason: "The row has no contact." });
      continue;
    }
    const [open] = await sql`
      select 1 from email_drafts
       where (opportunity_id = ${row.id} or contact_id = ${row.contactId}) and status = any(${OPEN_DRAFT_STATUSES}::text[])
       limit 1`;
    if (open) {
      result.skipped.push({ type: "email", ref: row.id, reason: "An email for this row is already waiting (open or postponed)." });
      continue;
    }
    // The card comes first: who they are (role, organization and its profile…) is filled, then the email is written.
    const [card] = await sql<{ researched: boolean; profileMissing: boolean }[]>`
      select c.researched_at is not null as researched, (o.id is not null and o.profile is null) as profile_missing
        from contacts c left join organizations o on o.id = c.organization_id
       where c.id = ${row.contactId}`;
    if (!card?.researched || card.profileMissing) {
      result.skipped.push({
        type: "email",
        ref: row.id,
        reason: !card?.researched
          ? "Fill the contact card first (POST /api/assistant-agent/contacts), then propose the email."
          : "Write the organization's profile first (POST /api/assistant-agent/profiles), then propose the email.",
      });
      continue;
    }
    seen.add(row.id);
    seen.add(row.contactId);
    try {
      const thread = await threadToContinue(row.contactId, email.subject, sheet.sendAccountId);
      const draft = await proposeEmail({
        contactId: row.contactId,
        accountId: thread ? thread.accountId : sheet.sendAccountId,
        replyToMessageId: thread?.messageId ?? null,
        subject: thread ? replySubject(thread.subject) || email.subject : email.subject,
        body: email.body,
        opportunityId: row.id,
        purpose: email.purpose ?? (row.stage === "lead" ? "outreach" : "follow_up"),
        origin: "assistant",
        rationale: email.reason,
        restrictRecipients: true,
      });
      if (!draft) {
        result.skipped.push({ type: "email", ref: row.id, reason: "An email for this contact is already waiting." });
        continue;
      }
      await sql`update email_drafts set assistant_reason = ${email.reason} where id = ${draft.id}`;
      const who = row.contactName ?? row.orgName ?? row.title;
      const [action] = await sql<{ id: string }[]>`
        insert into assistant_actions ${sql({
          projectId: sheet.id,
          opportunityId: row.id,
          contactId: row.contactId,
          kind: "email",
          title: `Email ${who}: ${email.subject}`.slice(0, 300),
          reason: email.reason,
          priority: email.priority,
          draftId: draft.id,
        })}
        returning id`;
      result.created.emails.push({ opportunityId: row.id, draftId: draft.id, actionId: action.id });
    } catch (e) {
      result.skipped.push({ type: "email", ref: row.id, reason: e instanceof DraftError ? e.message : errorMessage(e) });
    }
  }

  // Recommended actions (calls, WhatsApp, tasks…), never twice the same open one.
  for (const action of input.actions) {
    const row = action.opportunityId ? byId.get(action.opportunityId) : null;
    if (action.opportunityId && !row) {
      result.skipped.push({ type: "action", ref: action.opportunityId, reason: "Not a row of this campaign." });
      continue;
    }
    const [duplicate] = row
      ? await sql`
          select 1 from assistant_actions
           where project_id = ${sheet.id} and opportunity_id = ${row.id} and kind = ${action.kind} and status in ('open', 'postponed') limit 1`
      : await sql`
          select 1 from assistant_actions
           where project_id = ${sheet.id} and opportunity_id is null and lower(title) = lower(${action.title}) and status in ('open', 'postponed') limit 1`;
    if (duplicate) {
      result.skipped.push({ type: "action", ref: action.opportunityId ?? null, reason: "The same action is already open." });
      continue;
    }
    const [created] = await sql<{ id: string }[]>`
      insert into assistant_actions ${sql({
        projectId: sheet.id,
        opportunityId: row?.id ?? null,
        contactId: row?.contactId ?? null,
        kind: action.kind,
        title: action.title,
        reason: action.reason ?? null,
        priority: action.priority,
      })}
      returning id`;
    result.created.actions.push({ actionId: created.id, opportunityId: row?.id ?? null });
  }

  await sql`update projects set assistant_last_run_at = now() where id = ${sheet.id}`;
  return result;
}
