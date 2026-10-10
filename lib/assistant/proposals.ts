import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { DraftError, proposeEmail } from "@/lib/ai/approvals";
import { applyDraftRevision } from "@/lib/assistant/drafts";
import { ASSISTANT_ACTION_KINDS, MAX_EMAILS_PER_CALL } from "@/lib/assistant/types";
import { OPEN_DRAFT_STATUSES } from "@/lib/queries/assistant";
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
    .array(z.object({ draftId: z.guid(), subject: text(300), body: text(20_000) }))
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

export async function applyProposals(raw: unknown): Promise<ProposalsResult> {
  const parsed = proposalsSchema.safeParse(raw);
  if (!parsed.success) throw new ProposalError(`Invalid request: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, 400);
  const input = parsed.data;

  const [sheet] = await sql<{ id: string; active: boolean; archived: boolean; sendAccountId: string | null }[]>`
    select p.id, p.assistant_active as active, p.archived,
           (select a.id from gmail_accounts a where a.id = p.send_account_id and a.status = 'active') as send_account_id
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

  const result: ProposalsResult = { ok: true, projectId: sheet.id, created: { emails: [], actions: [], revisions: [] }, skipped: [] };

  // Emails: at most MAX_EMAILS_PER_CALL new proposals, never a second one for a row or contact.
  const seen = new Set<string>();
  for (const email of input.emails) {
    const row = byId.get(email.opportunityId);
    if (!row) {
      result.skipped.push({ type: "email", ref: email.opportunityId, reason: "Not a row of this campaign." });
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
    seen.add(row.id);
    seen.add(row.contactId);
    try {
      const draft = await proposeEmail({
        contactId: row.contactId,
        accountId: sheet.sendAccountId,
        subject: email.subject,
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

  // New versions of emails the owner asked to change.
  for (const revision of input.revisions) {
    const [owned] = await sql`
      select 1 from email_drafts d
       where d.id = ${revision.draftId}
         and (exists (select 1 from assistant_actions aa where aa.draft_id = d.id and aa.project_id = ${sheet.id})
              or exists (select 1 from opportunities op where op.id = d.opportunity_id and op.project_id = ${sheet.id}))`;
    if (!owned) {
      result.skipped.push({ type: "revision", ref: revision.draftId, reason: "Not an email of this campaign." });
      continue;
    }
    try {
      await applyDraftRevision(revision.draftId, { subject: revision.subject, body: revision.body });
      result.created.revisions.push({ draftId: revision.draftId });
    } catch (e) {
      result.skipped.push({ type: "revision", ref: revision.draftId, reason: e instanceof DraftError ? e.message : errorMessage(e) });
    }
  }

  await sql`update projects set assistant_last_run_at = now() where id = ${sheet.id}`;
  return result;
}
