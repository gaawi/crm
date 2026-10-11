"use server";

import { requireSession } from "@/lib/auth";
import { goalLabel, nextActionLabel, OPPORTUNITY_STAGES } from "@/lib/constants";
import { instrumentLabel, rosterLabel } from "@/lib/musicians/instruments";
import { listActivities } from "@/lib/queries/activities";
import { getContact, getContactHistory } from "@/lib/queries/contacts";
import { getDraft } from "@/lib/queries/drafts";
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
