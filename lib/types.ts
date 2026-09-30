/**
 * Domain types shared by pages, server actions, query functions and Claude tools.
 * Dates: `Date` for timestamps, 'YYYY-MM-DD' strings for calendar dates.
 */

export type ContactStatus = "new" | "lead" | "active" | "inactive" | "archived";
export type OpportunityStage = "lead" | "contacted" | "proposal" | "negotiation" | "won" | "lost";
export type Direction = "inbound" | "outbound";
export type AccountStatus = "active" | "reauth_required" | "disconnected";
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
}

export interface OrganizationRef {
  id: string;
  name: string;
}

export interface ContactRef {
  id: string;
  /** name, or the primary address when the contact has no name. */
  displayName: string;
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
  stage: OpportunityStage;
  contact: ContactRef | null;
  organization: OrganizationRef | null;
  project: ProjectRef | null;
  /** numeric(12,2) as string, e.g. "2500.00". */
  value: string | null;
  currency: string;
  followUpAt: string | null;
  nextStep: string | null;
  notes: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
