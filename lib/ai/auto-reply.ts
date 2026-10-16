import "server-only";
import { proposeEmail } from "@/lib/ai/approvals";
import { draftErrorMessage } from "@/lib/ai/draft";
import { writeEmailWithClaude } from "@/lib/ai/mail";
import { sql } from "@/lib/db";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/queries/settings";
import type { DraftOrigin, EmailDraft } from "@/lib/types";

/**
 * Replies prepared ahead of time. When the triage (lib/mail/triage.ts) finds
 * an important email that needs an answer, Claude writes the reply with time
 * to think (high effort, the whole conversation and the CRM context) and it
 * waits in Approvals with the other proposals. Nothing is ever sent without
 * the owner. Monitor-only mailboxes never get replies.
 */

/** Statuses of a proposal that is still waiting on the owner. */
const OPEN_DRAFT_STATUSES = ["proposed", "revising", "changes_requested", "postponed", "queued", "sending"];
/** A drafting claim not finished after this long (crashed run) can be taken again. */
const CLAIM_TIMEOUT_MINUTES = 15;
const MAX_ATTEMPTS = 2;
/** Only fairly recent emails get an automatic reply. */
const WINDOW_DAYS = 7;
/** …and only ones Vela stored recently. */
const ARRIVED_DAYS = 2;
/** Time one high-effort draft may need; none is started with less left. */
const DRAFT_TIME_MS = 120_000;
const CONCURRENCY = 2;

export const AUTO_REPLY_INSTRUCTIONS = `This reply is prepared ahead of time for the owner to review. Take the time to write it well:
- Answer everything the person asked or proposed, in the order they raised it, and move the conversation forward (a clear next step or question).
- Use only facts from the conversation and the CRM context. When the owner must supply something you do not know (a date, a fee, availability, a decision), write a short placeholder in square brackets, e.g. [confirm fee], so the owner fills it in before sending. Never invent facts.
- Match the language and tone of the conversation and the owner's earlier emails in it.`;

/**
 * Write a reply to the latest message of a conversation with Claude and add it
 * to Approvals. Shared by the composer's "Reply with Claude" button (origin
 * owner) and the automatic replies (origin autopilot). Returns null when an
 * automatic proposal is already open for this person.
 */
export async function proposeThreadReply(params: {
  accountId: string;
  threadId: string;
  instructions: string;
  origin: DraftOrigin;
  effort?: "medium" | "high";
  rationale?: string;
}): Promise<EmailDraft | null> {
  const [latest] = await sql<
    { id: string; direction: string; fromEmail: string | null; replyTo: string | null; toEmails: string[] | null; contactId: string | null }[]
  >`
    select m.id, m.direction, m.from_email,
           (select array_agg(mp.email order by mp.email) from message_participants mp
             where mp.message_id = m.id and mp.role = 'to') as to_emails,
           (select mp.email from message_participants mp where mp.message_id = m.id and mp.role = 'reply_to' limit 1) as reply_to,
           (select ce.contact_id from message_participants mp join contact_emails ce on ce.email = mp.email
             where mp.message_id = m.id and mp.role in ('from', 'reply_to', 'to') order by (mp.role = 'from') desc limit 1) as contact_id
      from messages m
     where m.account_id = ${params.accountId} and m.gmail_thread_id = ${params.threadId}
       and not (m.label_ids && '{TRASH,SPAM,DELETED}')
     order by (m.direction = 'inbound') desc, m.sent_at desc
     limit 1
  `;
  if (!latest) throw new ReplyError("This conversation has not been synced yet.");
  // Reply to the sender; when only the owner wrote in this thread, follow up with the same recipients.
  const to = (latest.direction === "inbound" ? [latest.replyTo ?? latest.fromEmail] : (latest.toEmails ?? [])).filter(
    (e): e is string => Boolean(e),
  );
  if (!to.length) throw new ReplyError("This conversation has no one to reply to.");
  const written = await writeEmailWithClaude({
    kind: "reply",
    accountId: params.accountId,
    threadId: params.threadId,
    to,
    subject: "",
    body: "",
    instructions: params.instructions,
    effort: params.effort,
  });
  return proposeEmail({
    accountId: params.accountId,
    contactId: latest.contactId,
    to,
    subject: written.subject,
    body: written.body,
    replyToMessageId: latest.id,
    purpose: "reply",
    origin: params.origin,
    rationale: params.rationale ?? "Reply to the latest message in this conversation.",
    restrictRecipients: true,
  });
}

export class ReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplyError";
  }
}

export interface AutoReplyResult {
  drafted: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface Candidate {
  messageId: string;
  accountId: string;
  threadId: string;
  reason: string | null;
}

/** Important emails waiting for an automatic reply, oldest first, claimed atomically. */
async function claimNext(): Promise<Candidate | null> {
  const [row] = await sql<Candidate[]>`
    with next as (
      select t.message_id
        from message_triage t
        join messages m on m.id = t.message_id
        join gmail_accounts a on a.id = m.account_id and a.status = 'active' and not a.monitor_only
       where t.important and t.needs_reply
         and (t.reply_status is null
              or (t.reply_status = 'drafting' and t.reply_started_at < now() - make_interval(mins => ${CLAIM_TIMEOUT_MINUTES}))
              or (t.reply_status = 'failed' and t.reply_attempts < ${MAX_ATTEMPTS}))
         and m.sent_at > now() - make_interval(days => ${WINDOW_DAYS})
         -- newly arrived mail only (not the backlog already in the inbox, nor the history import)
         and m.created_at > now() - make_interval(days => ${ARRIVED_DAYS})
         and m.label_ids @> '{INBOX}' and not (m.label_ids && '{TRASH,SPAM,DELETED}')
         -- still the latest message of the conversation: nobody (the owner included) has written since
         and not exists (select 1 from messages n where n.account_id = m.account_id and n.gmail_thread_id = m.gmail_thread_id
                           and n.sent_at > m.sent_at and not (n.label_ids && '{TRASH,SPAM,DELETED}'))
         -- no proposal already waiting in this conversation
         and not exists (select 1 from email_drafts d where d.account_id = m.account_id and d.gmail_thread_id = m.gmail_thread_id
                           and d.status = any(${OPEN_DRAFT_STATUSES}::text[]))
       order by m.sent_at
       limit 1
       for update of t skip locked
    )
    update message_triage t
       set reply_status = 'drafting', reply_started_at = now(), reply_attempts = t.reply_attempts + 1
      from next, messages m
     where t.message_id = next.message_id and m.id = t.message_id
    returning t.message_id, m.account_id, m.gmail_thread_id as thread_id, t.reason
  `;
  return row ?? null;
}

async function finish(messageId: string, status: "drafted" | "skipped" | "failed", note: string | null, draftId: string | null = null) {
  await sql`
    update message_triage set reply_status = ${status}, reply_note = ${note}, reply_draft_id = ${draftId}
     where message_id = ${messageId}
  `;
}

/** Automatic replies drafted today (owner's timezone), for the daily limit. */
async function draftedToday(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from message_triage
     where reply_status in ('drafting', 'drafted')
       and (reply_started_at at time zone ${env.timezone})::date = ${todayIn(env.timezone)}::date
  `;
  return row.count;
}

/** Draft the replies that are due, within the daily limit and the deadline. Never throws. */
export async function runAutoReplies(options: { deadline: number }): Promise<AutoReplyResult> {
  const result: AutoReplyResult = { drafted: 0, skipped: 0, failed: 0, errors: [] };
  try {
    if (!env.claudeInbox) return result;
    const settings = await getSettings("inbox");
    if (!settings.autoReplies) return result;
    let budget = Math.max(0, settings.autoRepliesPerDay - (await draftedToday()));

    const worker = async () => {
      while (budget > 0 && Date.now() < options.deadline - DRAFT_TIME_MS) {
        budget--;
        const next = await claimNext();
        if (!next) {
          budget = 0;
          return;
        }
        try {
          const draft = await proposeThreadReply({
            accountId: next.accountId,
            threadId: next.threadId,
            instructions: AUTO_REPLY_INSTRUCTIONS,
            origin: "autopilot",
            effort: "high",
            rationale: next.reason ? `Prepared automatically: ${next.reason}.` : "Prepared automatically for an email that needs your answer.",
          });
          if (draft) {
            await finish(next.messageId, "drafted", null, draft.id);
            result.drafted++;
          } else {
            await finish(next.messageId, "skipped", "Another automatic proposal is already open for this person.");
            result.skipped++;
          }
        } catch (error) {
          const message = error instanceof ReplyError ? error.message : draftErrorMessage(error);
          await finish(next.messageId, error instanceof ReplyError ? "skipped" : "failed", message);
          if (error instanceof ReplyError) result.skipped++;
          else {
            result.failed++;
            result.errors.push(message);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  if (result.errors.length) console.warn("Automatic replies:", result.errors.slice(0, 3).join(" | "));
  return result;
}
