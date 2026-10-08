import "server-only";
import { sql } from "@/lib/db";
import { proposeEmail } from "@/lib/ai/approvals";
import { createCampaign } from "@/lib/campaigns/campaigns";
import { renderTemplate, rowTemplateVars, suggestTemplate, templateRationale } from "@/lib/booking/templates";
import type { EmailTemplate, PrepareEmailsResult, SheetRow } from "@/lib/booking/types";
import { replySubject } from "@/lib/gmail/mime";
import { getSheet, getSheetRows } from "@/lib/queries/booking";
import { getSettings } from "@/lib/queries/settings";
import { listTemplates } from "@/lib/queries/templates";
import { env } from "@/lib/env";
import type { DraftPurpose } from "@/lib/types";
import { errorMessage } from "@/lib/utils";

/**
 * "Prepare email" on booking rows: each email is rendered from a template and
 * put in Approvals (a proposal plus a Gmail draft). Nothing is sent here.
 * Several emails prepared together form a campaign (lib/campaigns), sent
 * gradually only once the owner approves it.
 */

export const PREPARE_MAX_ROWS = 100;

/** The sheet's send-from account, else the first connected one (active first). */
async function sendAccountFor(sendAccountId: string | null): Promise<string | null> {
  if (sendAccountId) {
    const [row] = await sql<{ id: string }[]>`select id from gmail_accounts where id = ${sendAccountId} and status <> 'disconnected'`;
    if (row) return row.id;
  }
  const [row] = await sql<{ id: string }[]>`
    select id from gmail_accounts where status <> 'disconnected' order by (status = 'active') desc, created_at limit 1`;
  return row?.id ?? null;
}

/** My latest email to the contact from this account, while they have not answered: a follow-up replies in its thread. */
async function threadToFollowUp(row: SheetRow, accountId: string): Promise<{ id: string; subject: string | null } | null> {
  if (!row.contact?.awaitingReplySince) return null;
  const [message] = await sql<{ id: string; subject: string | null }[]>`
    select m.id, m.subject
      from contact_emails ce
      join message_participants mp on mp.email = ce.email and mp.role = 'to'
      join messages m on m.id = mp.message_id
     where ce.contact_id = ${row.contact.id} and m.direction = 'outbound' and m.account_id = ${accountId}
     order by m.sent_at desc
     limit 1
  `;
  return message ?? null;
}

async function hasOpenProposal(contactId: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from email_drafts where contact_id = ${contactId} and status in ('proposed', 'queued', 'revising', 'sending', 'failed') limit 1`;
  return Boolean(row);
}

/** "Oct 2" in the owner's timezone. */
function shortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: env.timezone, month: "short", day: "numeric" }).format(date);
}

/**
 * Prepare one email per row (at most 100): `templateId`, or the template
 * suggested for each row (its next step, else its status). Rows without an
 * email address or a fitting template, and contacts that already have an
 * email waiting in Approvals, are skipped with a reason. A follow-up to an
 * unanswered email replies in that email's thread ("Re: <its subject>").
 * More than one email prepared → a campaign (status draft, "<sheet> ·
 * <template or Suggested templates> · <date>") holding them all; its id is
 * returned. One email stays a normal proposal.
 */
export async function prepareSheetEmails(input: { projectId: string; rowIds: string[]; templateId?: string | null }): Promise<PrepareEmailsResult> {
  const rowIds = [...new Set(input.rowIds)];
  if (rowIds.length > PREPARE_MAX_ROWS) throw new Error(`Prepare at most ${PREPARE_MAX_ROWS} emails at a time.`);
  const sheet = await getSheet(input.projectId);
  if (!sheet) throw new Error("Booking sheet not found");
  const templates = await listTemplates(sheet.id);
  const chosen: EmailTemplate | null = input.templateId ? (templates.find((t) => t.id === input.templateId) ?? null) : null;
  if (input.templateId && !chosen) throw new Error("Template not found");

  const result: PrepareEmailsResult = { prepared: [], skipped: [], campaignId: null };
  const rows = new Map((await getSheetRows(sheet.id, { ids: rowIds })).map((r) => [r.id, r]));
  const accountId = await sendAccountFor(sheet.sendAccountId);
  const profile = await getSettings("profile");

  for (const rowId of rowIds) {
    const row = rows.get(rowId);
    if (!row) {
      result.skipped.push({ rowId, reason: "Not in this sheet" });
      continue;
    }
    if (!row.contact?.email) {
      result.skipped.push({ rowId, reason: "No email address" });
      continue;
    }
    const template = chosen ?? suggestTemplate(row, templates);
    if (!template) {
      result.skipped.push({ rowId, reason: "No template for this status" });
      continue;
    }
    if (!accountId) {
      result.skipped.push({ rowId, reason: "Connect a Gmail account first" });
      continue;
    }
    if (await hasOpenProposal(row.contact.id)) {
      result.skipped.push({ rowId, reason: "Already in Approvals" });
      continue;
    }

    const vars = rowTemplateVars(row, sheet, profile);
    let subject = renderTemplate(template.subject, vars).replace(/\s+/g, " ").trim();
    const body = renderTemplate(template.body, vars);
    const purpose: DraftPurpose =
      template.trigger === "follow_up" || template.trigger === "after_call" ? "follow_up" : template.trigger === "thanks" ? "other" : "outreach";
    let replyToMessageId: string | null = null;
    if (template.trigger === "follow_up") {
      const thread = await threadToFollowUp(row, accountId);
      if (thread) {
        replyToMessageId = thread.id;
        subject = replySubject(thread.subject) || subject;
      }
    }

    try {
      const draft = await proposeEmail({
        accountId,
        contactId: row.contact.id,
        opportunityId: row.id,
        to: [row.contact.email],
        subject,
        body,
        replyToMessageId,
        purpose,
        origin: "owner",
        rationale: templateRationale(sheet.name, template.name),
      });
      if (draft) result.prepared.push({ rowId, draftId: draft.id, templateName: template.name });
      else result.skipped.push({ rowId, reason: "Already in Approvals" });
    } catch (error) {
      result.skipped.push({ rowId, reason: errorMessage(error) });
    }
  }

  if (result.prepared.length > 1 && accountId) {
    const names = new Set(result.prepared.map((p) => p.templateName));
    const templateName = chosen?.name ?? (names.size === 1 ? [...names][0] : "Suggested templates");
    result.campaignId = await createCampaign({
      name: `${sheet.name} · ${templateName} · ${shortDate(new Date())}`,
      accountId,
      projectId: sheet.id,
      draftIds: result.prepared.map((p) => p.draftId),
    });
  }
  return result;
}
