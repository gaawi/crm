"use server";

import { requireSession } from "@/lib/auth";
import { goalLabel, nextActionLabel, OPPORTUNITY_STAGES } from "@/lib/constants";
import { instrumentLabel, rosterLabel } from "@/lib/musicians/instruments";
import { listActivities } from "@/lib/queries/activities";
import { getContact, getContactHistory } from "@/lib/queries/contacts";
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

export async function loadCardInfo(draftId: string): Promise<{ ok: true; info: CardInfo } | { ok: false; error: string }> {
  await requireSession();
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, error: "This email is no longer waiting for approval." };
  const contactId = draft.contact?.id ?? null;
  const [contact, goal, history, activities, musician] = await Promise.all([
    contactId ? getContact(contactId) : null,
    draft.opportunityId ? getOpportunity(draft.opportunityId) : null,
    contactId ? getContactHistory(contactId, { limit: 5, includeAutomated: false }) : [],
    contactId ? listActivities({ contactId, limit: 4 }) : [],
    contactId ? getMusicianProfile(contactId) : null,
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
}

/**
 * The conversation an email to approve belongs to, oldest first: the Gmail
 * thread it replies to ("thread"), else the latest emails with the contact
 * ("history", so a new email shows what came before), else nothing ("none").
 */
export interface DraftThread {
  kind: "thread" | "history" | "none";
  messages: ThreadMessage[];
  /** Emails in the conversation, including older ones not sent to the card. */
  total: number;
}

const THREAD_MAX = 8;
const BODY_MAX = 8000;

export async function loadDraftThread(draftId: string): Promise<{ ok: true; thread: DraftThread } | { ok: false; error: string }> {
  await requireSession();
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, error: "This email is no longer waiting for approval." };
  const replied = draft.replyToMessageId ? await getMessage(draft.replyToMessageId) : null;
  const contactId = draft.contact?.id ?? null;
  let kind: DraftThread["kind"] = "none";
  let messages: Awaited<ReturnType<typeof getThread>> = [];
  if (replied) {
    kind = "thread";
    // The whole thread: an email that arrived after the draft was written matters most.
    messages = await getThread(replied.accountId, replied.gmailThreadId);
    if (!messages.length) messages = [replied];
  } else if (contactId) {
    messages = (await getContactHistory(contactId, { limit: 4, includeAutomated: false })).reverse();
    if (messages.length) kind = "history";
  }
  const name = (a: { name: string | null; email: string } | null | undefined) => a?.name || a?.email || "";
  return {
    ok: true,
    thread: {
      kind,
      total: messages.length,
      messages: messages.slice(-THREAD_MAX).map((m) => ({
        id: m.id,
        direction: m.direction,
        from: m.direction === "outbound" ? "You" : name(m.from),
        to: m.to.map(name).join(", "),
        sentAt: new Date(m.sentAt).toISOString(),
        subject: m.subject,
        body: (m.bodyText?.trim() || m.snippet || "").slice(0, BODY_MAX),
      })),
    },
  };
}
