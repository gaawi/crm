/**
 * Domain types shared by pages, server actions, query functions and Claude tools.
 * Dates: `Date` for timestamps, 'YYYY-MM-DD' strings for calendar dates.
 */

import type { OrgWithProfile } from "@/lib/organizations/profile";

export type ContactStatus = "new" | "lead" | "active" | "inactive" | "archived";
export type OpportunityStage = "lead" | "contacted" | "proposal" | "negotiation" | "won" | "lost";
/**
 * An opportunity is a goal with a contact / organization: what we want from
 * them (see GOAL_KINDS in lib/constants.ts for labels and groups).
 */
export type OpportunityKind =
  | "booking"
  | "perform_with"
  | "residency"
  | "education"
  | "broadcast"
  | "venue"
  | "exchange"
  | "fundraising"
  | "sponsorship"
  | "grant"
  | "partnership"
  | "coproduction"
  | "network"
  | "introduction"
  | "press"
  | "sale"
  | "other";
/** Group of a goal kind in pickers. */
export type GoalGroup = "performances" | "support" | "partnerships" | "visibility" | "other";
/** The structured next step of a goal (see NEXT_ACTIONS in lib/constants.ts). next_step stays the free-text detail. */
export type NextAction =
  | "first_contact"
  | "call"
  | "send_proposal"
  | "send_materials"
  | "follow_up"
  | "meeting"
  | "agree_terms"
  | "send_contract"
  | "close_contract"
  | "logistics"
  | "invoice"
  | "thank_report"
  | "keep_informed"
  | "wait_reply";
export type OrganizationKind = "venue" | "funder" | "partner" | "press" | "agency" | "institution" | "other";
/** queued = approved as part of a running campaign, waiting its turn to be sent. */
export type DraftStatus =
  | "proposed"
  | "queued"
  | "revising"
  | "sending"
  | "sent"
  | "discarded"
  | "failed"
  /** The owner put it off until postponed_until; it comes back as proposed that day. */
  | "postponed"
  /** The owner asked the campaign assistant for a new version (revision_request). */
  | "changes_requested";
/** draft = prepared, waiting for the owner's approval; running = sending gradually. */
export type CampaignStatus = "draft" | "running" | "paused" | "done" | "cancelled";
export type DraftPurpose = "reply" | "follow_up" | "nudge" | "outreach" | "other";
export type DraftOrigin = "assistant" | "autopilot" | "owner";
export type Direction = "inbound" | "outbound";
export type AccountStatus = "active" | "reauth_required" | "disconnected";
/** Logged by hand (everything but synced email); "status" = automatic entry when a booking row's status changes. */
export type ActivityKind = "call" | "whatsapp" | "meeting" | "email" | "note" | "status";
/** Calls only. reached = talked to them. */
export type CallOutcome = "reached" | "no_answer" | "voicemail" | "call_back" | "wrong_number";
/** The situation an email template is suggested for (custom = never suggested, pick it by hand). */
export type TemplateTrigger =
  | "first_contact"
  | "returning"
  | "follow_up"
  | "after_call"
  | "next_steps"
  | "confirmed"
  | "declined"
  | "keep_informed"
  | "thanks"
  | "custom";
export type BackfillStatus = "pending" | "running" | "done" | "error";

export interface Address {
  /** Lower-cased address. */
  email: string;
  name: string | null;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
}

export interface ProjectRef {
  id: string;
  name: string;
  color: string;
  /** A booking sheet (set on deals' projects). */
  sheet?: boolean;
}

export interface OrganizationRef {
  id: string;
  name: string;
  kind?: OrganizationKind | null;
}

export interface ContactRef {
  id: string;
  /** name, or the primary address when the contact has no name. */
  displayName: string;
  /** Normalized ("+34612345678"); present on opportunities' contacts. */
  phone?: string | null;
  whatsapp?: string | null;
}

export interface ContactSummary {
  id: string;
  name: string | null;
  displayName: string;
  primaryEmail: string | null;
  /** Primary first. */
  emails: string[];
  organization: OrganizationRef | null;
  role: string | null;
  /** Normalized: digits with an optional leading + ("+34612345678"). */
  phone: string | null;
  /** WhatsApp number when it differs from `phone` (same format). */
  whatsapp: string | null;
  tags: string[];
  status: ContactStatus;
  projects: ProjectRef[];
  followUpAt: string | null;
  followUpNote: string | null;
  lastContactedAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  messageCount: number;
}

export interface Contact extends ContactSummary {
  notes: string | null;
  source: "manual" | "gmail";
  replyDismissedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailMessage {
  /** messages.id of the representative row (de-duplicated across accounts). */
  id: string;
  accountId: string;
  accountEmail: string;
  /** Every connected account that holds a copy of this email. */
  accounts: string[];
  gmailMessageId: string;
  gmailThreadId: string;
  rfc822MessageId: string | null;
  direction: Direction;
  from: Address | null;
  to: Address[];
  cc: Address[];
  subject: string | null;
  snippet: string | null;
  /** Plain text, quoted replies stripped. Null for automated mail. */
  bodyText: string | null;
  sentAt: Date;
  isAutomated: boolean;
  hasAttachments: boolean;
  attachments: Attachment[];
  /** Opens the thread in Gmail, in the right account. */
  gmailUrl: string;
}

export interface Organization {
  id: string;
  name: string;
  kind: OrganizationKind | null;
  city: string | null;
  domains: string[];
  website: string | null;
  notes: string | null;
  tags: string[];
  contactCount: number;
  lastContactedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  description: string | null;
  archived: boolean;
  sortOrder: number;
  contactCount: number;
  openOpportunityCount: number;
}

export interface Opportunity {
  id: string;
  title: string;
  kind: OpportunityKind;
  stage: OpportunityStage;
  contact: ContactRef | null;
  organization: OrganizationRef | null;
  project: ProjectRef | null;
  /** numeric(12,2) as string, e.g. "2500.00". */
  value: string | null;
  currency: string;
  /** Due date of the next step. */
  followUpAt: string | null;
  /** Structured next step (null = none set). */
  nextAction: NextAction | null;
  /** Free-text detail of the next step. */
  nextStep: string | null;
  notes: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Input of createGoalAction / updateGoalAction (pipeline) and addContactGoalAction (contact page). */
export interface GoalInput {
  title?: string;
  kind?: OpportunityKind;
  stage?: OpportunityStage;
  contactId?: string | null;
  organizationId?: string | null;
  projectId?: string | null;
  /** As typed ("4.500 €", "2500.50") or a number; "" / null clears. */
  value?: string | number | null;
  /** ISO 4217, e.g. "EUR". */
  currency?: string;
  /** 'YYYY-MM-DD', "" / null clears. */
  followUpAt?: string | null;
  /** "" / null clears. */
  nextAction?: NextAction | "" | null;
  nextStep?: string | null;
  notes?: string | null;
}

export interface GmailAccountView {
  id: string;
  email: string;
  displayName: string | null;
  status: AccountStatus;
  backfillStatus: BackfillStatus;
  backfillImported: number;
  backfillScanned: number;
  backfillEstimate: number | null;
  backfillStartedAt: Date | null;
  backfillCompletedAt: Date | null;
  /** Import is unfinished and nothing is currently working on it. */
  backfillStalled: boolean;
  lastSyncedAt: Date | null;
  watchExpiresAt: Date | null;
  /** Push notifications configured and the watch is current. */
  pushActive: boolean;
  lastError: string | null;
  lastErrorAt: Date | null;
  messageCount: number;
  createdAt: Date;
}

export interface FollowUps {
  /** follow_up_at <= today, oldest first. */
  due: ContactSummary[];
  /** They wrote last. Most recent first. */
  needsReply: ContactSummary[];
  /** I wrote last, more than N days ago, no answer. Oldest first. */
  awaitingReply: ContactSummary[];
  /** Open opportunities with follow_up_at <= today. */
  opportunities: Opportunity[];
}

/** An email waiting for the owner's approval (see email_drafts). */
export interface EmailDraft {
  id: string;
  accountId: string;
  accountEmail: string;
  contact: ContactRef | null;
  opportunityId: string | null;
  /** The campaign it belongs to (sent gradually once the campaign is approved), null = standalone. */
  campaignId: string | null;
  replyToMessageId: string | null;
  /** Subject of the message being replied to, for context. */
  replyToSubject: string | null;
  purpose: DraftPurpose;
  origin: DraftOrigin;
  status: DraftStatus;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  rationale: string | null;
  /** Why the daily campaign assistant proposes this email (null = not from the campaign assistant). */
  assistantReason: string | null;
  /** The owner's comment when they asked for a new version. */
  revisionRequest: string | null;
  /** 'YYYY-MM-DD' while postponed. */
  postponedUntil: string | null;
  revisions: { at: string; note: string | null; subject: string; body: string }[];
  gmailDraftId: string | null;
  gmailThreadId: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  /** The contact's organization (else the goal's) when it has a profile. */
  organization?: OrgWithProfile | null;
}
