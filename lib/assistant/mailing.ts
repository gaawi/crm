import "server-only";
import { z } from "zod";
import { sql } from "@/lib/db";
import { DraftError, proposeEmail } from "@/lib/ai/approvals";
import { CampaignError, createCampaign, discardCampaign } from "@/lib/campaigns/campaigns";
import { noEmDash } from "@/lib/text/no-em-dash";
import { errorMessage } from "@/lib/utils";

/**
 * A mailing of personalized emails, written outside the app (POST
 * /api/assistant-agent/mailing): one email per row of a campaign, each to the
 * row's contact, from the campaign's send account. They wait in Approvals as
 * one mailing; nothing is sent until the owner approves it ("Approve N and
 * start sending"), and then the scheduler sends them gradually. The first call
 * creates the mailing (`name`); later calls add to it (`mailingId`) while it
 * still waits for approval.
 */

export const MAX_MAILING_EMAILS_PER_CALL = 50;

const text = (max: number) => z.string().trim().min(1).max(max);

const settingsSchema = z
  .object({
    perHour: z.number().int().optional(),
    dailyCap: z.number().int().optional(),
    windowStart: z.number().int().optional(),
    windowEnd: z.number().int().optional(),
    weekdaysOnly: z.boolean().optional(),
    timezone: z.string().trim().max(64).optional(),
  })
  .optional();

const mailingSchema = z
  .object({
    projectId: z.guid(),
    mailingId: z.guid().optional(),
    name: text(200).optional(),
    settings: settingsSchema,
    emails: z
      .array(
        z.object({
          opportunityId: z.guid(),
          subject: text(300),
          body: text(20_000),
          /** For the owner, on the card: why this email says what it says (history, verified contact…). */
          reason: text(1000),
        }),
      )
      .min(1)
      .max(MAX_MAILING_EMAILS_PER_CALL),
  })
  .refine((v) => v.mailingId || v.name, { message: "Send a name for a new mailing, or the mailingId to add to." });

export class MailingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface MailingResult {
  ok: true;
  mailingId: string | null;
  created: { opportunityId: string; draftId: string }[];
  skipped: { opportunityId: string; reason: string }[];
}

const discardSchema = z.object({ projectId: z.guid(), discardMailingId: z.guid() });

/**
 * Replace a mailing that was never approved (e.g. rewritten with other
 * templates): its emails are discarded and their Gmail drafts deleted. Only a
 * mailing still waiting for approval, in this campaign; nothing was sent.
 */
async function discardMailing(raw: unknown): Promise<{ ok: true; discarded: number }> {
  const parsed = discardSchema.safeParse(raw);
  if (!parsed.success) throw new MailingError("Send {projectId, discardMailingId}.", 400);
  const [mailing] = await sql<{ status: string; sent: number }[]>`
    select c.status, (select count(*)::int from email_drafts d where d.campaign_id = c.id and d.status in ('sent', 'sending')) as sent
      from email_campaigns c where c.id = ${parsed.data.discardMailingId} and c.project_id = ${parsed.data.projectId}`;
  if (!mailing) throw new MailingError("Mailing not found in this campaign.", 404);
  if (mailing.status !== "draft" || mailing.sent) throw new MailingError("Only a mailing still waiting for approval can be discarded here.", 409);
  return { ok: true, discarded: await discardCampaign(parsed.data.discardMailingId) };
}

export async function applyMailing(raw: unknown): Promise<MailingResult | { ok: true; discarded: number }> {
  if (raw && typeof raw === "object" && "discardMailingId" in raw) return discardMailing(raw);
  const parsed = mailingSchema.safeParse(raw);
  if (!parsed.success)
    throw new MailingError(`Invalid request: ${parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")}`, 400);
  const input = parsed.data;

  const [sheet] = await sql<{ id: string; accountId: string | null }[]>`
    select p.id,
           (select a.id from gmail_accounts a where a.id = p.send_account_id and a.status = 'active' and not a.monitor_only) as account_id
      from projects p where p.id = ${input.projectId} and p.sheet and not p.archived`;
  if (!sheet) throw new MailingError("Campaign not found.", 404);
  if (!sheet.accountId) throw new MailingError("Give the campaign a Gmail account that can send.", 409);

  if (input.mailingId) {
    const [mailing] = await sql<{ status: string }[]>`
      select status from email_campaigns where id = ${input.mailingId} and project_id = ${sheet.id}`;
    if (!mailing) throw new MailingError("Mailing not found in this campaign.", 404);
    if (mailing.status !== "draft") throw new MailingError("That mailing is no longer waiting for approval: start a new one.", 409);
  }

  const ids = [...new Set(input.emails.map((e) => e.opportunityId))];
  const rows = await sql<{ id: string; contactId: string | null; email: string | null; open: boolean }[]>`
    select op.id, op.contact_id,
           (select ce.email from contact_emails ce where ce.contact_id = op.contact_id order by ce.is_primary desc, ce.created_at limit 1) as email,
           exists (select 1 from email_drafts d where d.contact_id = op.contact_id
                    and d.status in ('proposed', 'queued', 'revising', 'sending', 'failed', 'changes_requested')) as open
      from opportunities op
     where op.project_id = ${sheet.id} and op.id = any(${ids}::uuid[])`;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const result: MailingResult = { ok: true, mailingId: input.mailingId ?? null, created: [], skipped: [] };
  const seen = new Set<string>();
  for (const email of input.emails) {
    const row = byId.get(email.opportunityId);
    const skip = (reason: string) => result.skipped.push({ opportunityId: email.opportunityId, reason });
    if (!row) {
      skip("Not a row of this campaign.");
      continue;
    }
    if (!row.contactId || !row.email) {
      skip("The row has no contact with an email address.");
      continue;
    }
    if (seen.has(row.id) || seen.has(row.contactId)) {
      skip("Duplicate in this request.");
      continue;
    }
    seen.add(row.id).add(row.contactId);
    if (row.open) {
      skip("This contact already has an email waiting in Approvals.");
      continue;
    }
    try {
      const draft = await proposeEmail({
        accountId: sheet.accountId,
        contactId: row.contactId,
        opportunityId: row.id,
        to: [row.email],
        subject: noEmDash(email.subject),
        body: noEmDash(email.body),
        purpose: "outreach",
        origin: "owner",
        restrictRecipients: true,
        rationale: noEmDash(email.reason),
      });
      if (draft) result.created.push({ opportunityId: row.id, draftId: draft.id });
      else skip("This contact already has an email waiting in Approvals.");
    } catch (error) {
      skip(error instanceof DraftError ? error.message : errorMessage(error));
    }
  }

  const draftIds = result.created.map((c) => c.draftId);
  if (!draftIds.length) return result;
  if (input.mailingId) {
    await sql`
      update email_drafts set campaign_id = ${input.mailingId}
       where id = any(${draftIds}::uuid[]) and campaign_id is null and status in ('proposed', 'failed')`;
  } else {
    try {
      result.mailingId = await createCampaign({ name: input.name!, accountId: sheet.accountId, projectId: sheet.id, draftIds, settings: input.settings });
    } catch (error) {
      if (error instanceof CampaignError) throw new MailingError(error.message, 400);
      throw error;
    }
  }
  return result;
}
