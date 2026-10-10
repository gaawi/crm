/**
 * Booking sheet data as the client receives it (no "server-only": safe to
 * import from client components). Timestamps are ISO strings
 * ("2026-10-01T14:30:00.000Z"), calendar dates 'YYYY-MM-DD'.
 */
import type { AccountStatus, ActivityKind, CallOutcome, Direction, NextAction, OpportunityKind, OpportunityStage, TemplateTrigger } from "@/lib/types";
import type { OrgProfile } from "@/lib/organizations/profile";

export type { ActivityKind, CallOutcome, NextAction, OpportunityKind, TemplateTrigger };

/** Rows per stage, named as the booking stages read. */
export interface SheetStageCounts {
  /** lead */
  toContact: number;
  contacted: number;
  /** proposal ("Offer sent") */
  proposal: number;
  /** negotiation */
  inConversation: number;
  /** won */
  confirmed: number;
  /** lost */
  declined: number;
}

export interface BookingSheet {
  id: string;
  name: string;
  color: string;
  description: string | null;
  currency: string;
  /** "+34": added to numbers typed without a country code in this sheet. */
  phonePrefix: string | null;
  /** Mailbox used when preparing emails (null = the first connected one). */
  sendAccountId: string | null;
  rows: number;
  /**
   * Distinct goal kinds of the sheet's rows (sorted; empty when it has no
   * rows). labelKindFor(kinds) in lib/constants.ts → the kind whose stage
   * labels the sheet's strip uses (null = generic labels).
   */
  kinds: OpportunityKind[];
  /** Not confirmed or declined. */
  open: number;
  confirmed: number;
  declined: number;
  /** Open rows whose follow-up date is today or earlier. */
  followUpsDue: number;
  /** Contacted / Offer sent rows waiting on an answer for more than FOLLOW_UP_OVERDUE_DAYS. */
  noReply: number;
  counts: SheetStageCounts;
}

export interface SheetRowContact {
  id: string;
  /** The contact's own name (null when unnamed). Use for greetings. */
  name: string | null;
  /** name, else primary email, else "Unknown". */
  displayName: string;
  role: string | null;
  /** Primary address. */
  email: string | null;
  /** Normalized ("+34612345678"). */
  phone: string | null;
  whatsapp: string | null;
  /** https photo; null/absent = initials. */
  photoUrl?: string | null;
  lastContactedAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** My latest unanswered email to them. */
  awaitingReplySince: string | null;
  /** An email to them already waiting in Approvals (Prepare email would skip them). */
  openDraftId: string | null;
}

export interface SheetRowActivity {
  kind: Exclude<ActivityKind, "status">;
  outcome: CallOutcome | null;
  occurredAt: string;
  body: string | null;
}

export interface SheetRow {
  /** The row's opportunity (goal) id. */
  id: string;
  title: string;
  /** The goal with this venue / organization (rows default to "booking"). Stage labels follow it. */
  kind: OpportunityKind;
  stage: OpportunityStage;
  /** Fee: numeric string ("4500.00") or null. */
  value: string | null;
  currency: string;
  /** Due date of the next step. */
  followUpAt: string | null;
  /** Structured next step (null = none). */
  nextAction: NextAction | null;
  /** Free-text detail of the next step. */
  nextStep: string | null;
  notes: string | null;
  eventDates: string | null;
  /** Group within the sheet ("Cultura en Rede"), null = none. */
  section: string | null;
  /** Halls / spaces at the venue. */
  spaces: string | null;
  /** Worked together before. */
  returning: boolean;
  createdAt: string;
  updatedAt: string;
  /** profile: what Claude or the owner wrote about the organization (null = none yet). */
  organization: { id: string; name: string; city: string | null; website: string | null; profile?: OrgProfile | null } | null;
  contact: SheetRowContact | null;
  /** Latest non-status activity of the row or its contact. */
  lastActivity: SheetRowActivity | null;
  /** Latest call of the row or its contact. */
  lastCall: { outcome: CallOutcome | null; occurredAt: string } | null;
  /** Non-status activities of the row or its contact. */
  activityCount: number;
}

/** What a sheet row is created from (the add form, an import). */
export interface SheetRowInput {
  organization: string;
  city?: string | null;
  website?: string | null;
  spaces?: string | null;
  section?: string | null;
  contactName?: string | null;
  role?: string | null;
  email?: string | null;
  /** Typed as the owner wrote it; normalized with the sheet's phone prefix. */
  phone?: string | null;
  whatsapp?: string | null;
  eventDates?: string | null;
  fee?: string | null;
  followUpAt?: string | null;
  /** Structured next step. */
  nextAction?: NextAction | null;
  nextStep?: string | null;
  notes?: string | null;
  stage?: OpportunityStage;
  /** Default "booking". */
  kind?: OpportunityKind;
  returning?: boolean;
}

/** Inline-editable fields of a row (updateCellAction's `name`). */
export type SheetField =
  | "stage"
  | "kind"
  | "followUpAt"
  | "nextAction"
  | "nextStep"
  | "eventDates"
  | "fee"
  | "notes"
  | "section"
  | "spaces"
  | "returning"
  | "phone"
  | "whatsapp";

export interface ActivityView {
  id: string;
  kind: ActivityKind;
  outcome: CallOutcome | null;
  body: string | null;
  occurredAt: string;
  createdAt: string;
  contactId: string | null;
  organizationId: string | null;
  opportunityId: string | null;
}

export type TimelineItem =
  | ({ type: "activity"; at: string } & ActivityView)
  | {
      type: "email";
      /** messages.id */
      id: string;
      at: string;
      /** outbound = from me (↗), inbound = from them (↙). */
      direction: Direction;
      subject: string | null;
      snippet: string | null;
      accountId: string;
      accountEmail: string;
      gmailThreadId: string;
      /** In-app thread: /mail/t/<accountId>/<gmailThreadId> */
      href: string;
    };

export interface Timeline {
  opportunityId: string | null;
  contactId: string | null;
  organizationId: string | null;
  /** Newest first, at most 100. */
  items: TimelineItem[];
}

export interface EmailTemplate {
  id: string;
  /** null = available in every sheet. */
  projectId: string | null;
  name: string;
  trigger: TemplateTrigger;
  subject: string;
  body: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** A Gmail account emails can be prepared from (connected, i.e. not disconnected). */
export interface SendAccount {
  id: string;
  email: string;
  displayName: string | null;
  status: AccountStatus;
}

export interface PrepareEmailsResult {
  /** draftId = the proposal's id in Approvals (email_drafts.id). */
  prepared: { rowId: string; draftId: string; templateName: string }[];
  skipped: { rowId: string; reason: string }[];
  /**
   * More than one email prepared: they form a campaign (status "draft")
   * shown in Approvals, sent gradually only after the owner approves it
   * ("Approve N and start sending"). Null for a single email (a normal
   * proposal) or none.
   */
  campaignId: string | null;
}

export interface ImportResult {
  created: number;
  /** Rows not imported (errors and duplicates). */
  skipped: number;
  errors: { line: number; message: string }[];
}

/** What the booking / activity server actions return: `ok` plus data, or an error to show. */
export type ActionOutcome<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Input of addActivityAction / logCallAction (app/(app)/activity-actions.ts). */
export interface ActivityInput {
  /** "status" entries are automatic (change a row's status with updateCellAction). */
  kind: Exclude<ActivityKind, "status">;
  /** Calls only. */
  outcome?: CallOutcome | null;
  body?: string | null;
  /** "YYYY-MM-DDTHH:mm" wall-clock in the owner's timezone (datetime-local), or an ISO string with Z / offset. Default now. */
  occurredAt?: string | null;
  /** At least one of the three. A row's contact and organization are filled in from it. */
  opportunityId?: string | null;
  contactId?: string | null;
  organizationId?: string | null;
  /** 'YYYY-MM-DD': also set the follow-up (on the row, or on the contact when there is no row). */
  followUpAt?: string | null;
  /** The row's next step detail (or the contact's follow-up note). */
  nextStep?: string | null;
  /**
   * The row's structured next step: omit to keep it, null to clear it. On a
   * contact without a row it only fills the follow-up note (with its label)
   * when followUpAt is given and nextStep is empty. The log-call dialog
   * presets "call" after "No answer" / "Call back".
   */
  nextAction?: NextAction | null;
}

/** Input of updateSheetSettingsAction. */
export interface SheetSettingsInput {
  name: string;
  currency: string;
  /** "+34" / "" */
  phonePrefix: string;
  /** "" = the first connected account. */
  sendAccountId: string;
  description: string;
}

/** Input of createTemplateAction / updateTemplateAction. */
export interface TemplateFormInput {
  name: string;
  trigger: TemplateTrigger;
  subject: string;
  body: string;
  sortOrder?: number;
}
