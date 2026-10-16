import "server-only";

import { cardMissing, type CardField } from "@/lib/contacts/card";
import { sql } from "@/lib/db";
import { goalLabel, nextActionLabel, OPPORTUNITY_STAGES } from "@/lib/constants";
import { instrumentLabel, rosterLabel } from "@/lib/musicians/instruments";
import { listActivities } from "@/lib/queries/activities";
import { getContact, getContactHistory } from "@/lib/queries/contacts";
import { getRelatedHistory } from "@/lib/queries/organizations";
import { getDraft } from "@/lib/queries/drafts";
import { getMessage, getThread } from "@/lib/queries/messages";
import { getMusicianProfile } from "@/lib/queries/musicians";
import { getOpportunity } from "@/lib/queries/opportunities";
import type { ContactStatus } from "@/lib/types";

/**
 * The back of an approval flashcard: who the email is for (contact, goal,
 * musician card, notes) and what happened lately (emails, calls). Read when
 * the card is turned over. Never includes the private musician rating.
 */
export interface CardInfo {
  contact: {
    id: string;
    displayName: string;
    photoUrl: string | null;
    photoSource: string | null;
    role: string | null;
    organization: { id: string; name: string } | null;
    status: ContactStatus;
    emails: string[];
    phone: string | null;
    whatsapp: string | null;
    tags: string[];
    notes: string | null;
    followUpAt: string | null;
    followUpNote: string | null;
    lastContactedAt: string | null;
    messageCount: number;
    projects: { id: string; name: string; color: string }[];
    /** When Claude filled the card, from which pages, and what it still lacks. */
    researchedAt: string | null;
    researchSources: string[];
    cardMissing: CardField[];
  } | null;
  goal: {
    id: string;
    title: string;
    kind: string;
    stage: string;
    nextAction: string | null;
    nextStep: string | null;
    followUpAt: string | null;
    value: string | null;
    currency: string;
    project: string | null;
    notes: string | null;
  } | null;
  musician: { instruments: string[]; roster: string; basedIn: string | null; website: string | null } | null;
  emails: { id: string; direction: "inbound" | "outbound"; sentAt: string; subject: string | null; snippet: string | null; from: string | null }[];
  activities: { id: string; kind: string; outcome: string | null; body: string | null; occurredAt: string }[];
}

export async function cardInfo(draftId: string): Promise<{ ok: true; info: CardInfo } | { ok: false; error: string }> {
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, error: "This email is no longer waiting for approval." };
  const contactId = draft.contact?.id ?? null;
  const [contact, goal, history, activities, musician, research] = await Promise.all([
    contactId ? getContact(contactId) : null,
    draft.opportunityId ? getOpportunity(draft.opportunityId) : null,
    contactId ? getContactHistory(contactId, { limit: 5, includeAutomated: false }) : [],
    contactId ? listActivities({ contactId, limit: 4 }) : [],
    contactId ? getMusicianProfile(contactId) : null,
    contactId
      ? sql<{ researchedAt: Date | null; researchSources: string[]; organizationHasProfile: boolean }[]>`
          select c.researched_at, c.research_sources, (o.profile is not null) as organization_has_profile
            from contacts c left join organizations o on o.id = c.organization_id where c.id = ${contactId}`.then((r) => r[0] ?? null)
      : null,
  ]);
  const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
  return {
    ok: true,
    info: {
      contact: contact
        ? {
            id: contact.id,
            displayName: contact.displayName,
            photoUrl: contact.photoUrl ?? null,
            photoSource: contact.photoSource,
            role: contact.role,
            organization: contact.organization ? { id: contact.organization.id, name: contact.organization.name } : null,
            status: contact.status,
            emails: contact.emails,
            phone: contact.phone,
            whatsapp: contact.whatsapp,
            tags: contact.tags,
            notes: contact.notes,
            followUpAt: contact.followUpAt,
            followUpNote: contact.followUpNote,
            lastContactedAt: iso(contact.lastContactedAt),
            messageCount: contact.messageCount,
            projects: contact.projects.map((p) => ({ id: p.id, name: p.name, color: p.color })),
            researchedAt: iso(research?.researchedAt),
            researchSources: research?.researchSources ?? [],
            cardMissing: cardMissing({
              name: contact.name,
              role: contact.role,
              organizationId: contact.organization?.id ?? null,
              organizationHasProfile: research?.organizationHasProfile ?? false,
              phone: contact.phone,
              photoUrl: contact.photoUrl ?? null,
            }),
          }
        : null,
      goal: goal
        ? {
            id: goal.id,
            title: goal.title,
            kind: goalLabel(goal.kind),
            stage: OPPORTUNITY_STAGES.find((s) => s.value === goal.stage)?.label ?? goal.stage,
            nextAction: nextActionLabel(goal.nextAction),
            nextStep: goal.nextStep,
            followUpAt: goal.followUpAt,
            value: goal.value,
            currency: goal.currency,
            project: goal.project?.name ?? null,
            notes: goal.notes,
          }
        : null,
      musician: musician
        ? {
            instruments: musician.instruments.map(instrumentLabel),
            roster: rosterLabel(musician.roster),
            basedIn: musician.basedIn,
            website: musician.website,
          }
        : null,
      emails: history.map((m) => ({
        id: m.id,
        direction: m.direction,
        sentAt: new Date(m.sentAt).toISOString(),
        subject: m.subject,
        snippet: m.snippet,
        from: m.from?.name || m.from?.email || null,
      })),
      activities: activities.map((a) => ({ id: a.id, kind: a.kind, outcome: a.outcome, body: a.body, occurredAt: a.occurredAt })),
    },
  };
}

/** One earlier email shown above the reply on the front of the card. */
export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  sentAt: string;
  subject: string | null;
  /** Plain text without the quoted part; the snippet when there is no text. */
  body: string;
  /** People it went to (To, Cc and Bcc): more than a few = a bulk email. */
  recipients: number;
  /** With this person, or with someone else at their organization (a former director, another address). */
  about?: "person" | "organization";
}

/**
 * The conversation an email to approve belongs to, oldest first: the Gmail
 * thread it replies to ("thread"), else the latest emails with the contact
 * ("history", so a new email shows what came before), else nothing ("none").
 */
export interface DraftThread {
  /** "organization": nothing with this person yet, but earlier emails with their organization. */
  kind: "thread" | "history" | "organization" | "none";
  /** The organization the earlier emails were with. */
  organizationName?: string | null;
  messages: ThreadMessage[];
  /** Emails in the conversation, including older ones not sent to the card. */
  total: number;
}

const THREAD_MAX = 8;
const BODY_MAX = 8000;

export async function draftThread(draftId: string): Promise<{ ok: true; thread: DraftThread } | { ok: false; error: string }> {
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, error: "This email is no longer waiting for approval." };
  const contactId = draft.contact?.id ?? null;
  const [replied, contact] = await Promise.all([
    draft.replyToMessageId ? getMessage(draft.replyToMessageId) : null,
    contactId ? getContact(contactId) : null,
  ]);
  let kind: DraftThread["kind"] = "none";
  let messages: (Awaited<ReturnType<typeof getThread>>[number] & { about?: "person" | "organization" })[] = [];
  const organization = draft.organization ?? contact?.organization ?? null;
  if (replied) {
    kind = "thread";
    // The thread as this person lived it: an email sent to many (a mailing) gathers
    // everyone's replies and bounces in one Gmail thread; only the emails they
    // wrote or received are theirs. One that arrived after the draft matters most.
    const thread = await getThread(replied.accountId, replied.gmailThreadId);
    const people = [...new Set([...(contact?.emails ?? []), ...draft.to, ...draft.cc])];
    const theirs = thread.length
      ? await sql<{ messageId: string }[]>`
          select distinct message_id from message_participants
           where message_id = any(${thread.map((m) => m.id)}::uuid[]) and email = any(${people}::text[])`
      : [];
    const ids = new Set(theirs.map((r) => r.messageId));
    messages = thread.filter((m) => ids.has(m.id) || m.id === replied.id);
    if (!messages.length) messages = [replied];
  } else if (contactId || organization) {
    // The person first; with nothing from them, their organization (a former director, Josefina's emails…).
    messages = (await getRelatedHistory(contactId, organization?.id ?? null, { limit: 6 })).reverse();
    if (messages.some((m) => m.about === "person")) kind = "history";
    else if (messages.length) kind = "organization";
  }
  // Emails sent from a mailbox the owner only reads (Josefina's) are hers, not "You".
  const readOnly = new Set((await sql<{ email: string }[]>`select lower(email) as email from gmail_accounts where monitor_only`).map((r) => r.email));
  const name = (a: { name: string | null; email: string } | null | undefined) => a?.name || a?.email || "";
  const counts = messages.length
    ? await sql<{ messageId: string; n: number }[]>`
        select message_id, count(distinct email)::int as n from message_participants
         where message_id = any(${messages.map((m) => m.id)}::uuid[]) and role in ('to', 'cc', 'bcc')
         group by message_id`
    : [];
  const recipients = new Map(counts.map((r) => [r.messageId, r.n]));
  return {
    ok: true,
    thread: {
      kind,
      organizationName: organization?.name ?? null,
      total: messages.length,
      messages: messages.slice(-THREAD_MAX).map((m) => ({
        id: m.id,
        direction: m.direction,
        from: m.direction === "outbound" && !readOnly.has(m.accountEmail.toLowerCase()) ? "You" : name(m.from),
        to: m.to.map(name).join(", "),
        sentAt: new Date(m.sentAt).toISOString(),
        subject: m.subject,
        body: (m.bodyText?.trim() || m.snippet || "").slice(0, BODY_MAX),
        recipients: recipients.get(m.id) ?? m.to.length + m.cc.length,
        about: m.about,
      })),
    },
  };
}

/** Both parts of a card, as /api/approvals/card returns them (errors in place of a part that could not load). */
export async function cardFor(draftId: string): Promise<{ info: CardInfo | { error: string }; thread: DraftThread | { error: string } }> {
  const [info, thread] = await Promise.all([cardInfo(draftId), draftThread(draftId)]);
  return { info: info.ok ? info.info : { error: info.error }, thread: thread.ok ? thread.thread : { error: thread.error } };
}
