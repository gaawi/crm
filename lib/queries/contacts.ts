import "server-only";
import type { Contact, ContactStatus, ContactSummary, EmailMessage } from "@/lib/types";

/**
 * Contact reads/writes. All functions use `sql` from lib/db (camelCase results).
 * Contact summaries always include emails (primary first), organization ref,
 * projects (ordered by sort_order) and the denormalized history columns.
 */

export interface ContactFilters {
  /** Matches name, any address, organization name, role, tags (case-insensitive substring). */
  q?: string;
  projectId?: string;
  tag?: string;
  /** Default: every status except archived. "all" includes archived. */
  status?: ContactStatus | "all";
  organizationId?: string;
  sort?: "last_contacted" | "name" | "created" | "follow_up";
  limit?: number;
  offset?: number;
}

export async function listContacts(filters: ContactFilters = {}): Promise<{ contacts: ContactSummary[]; total: number }> {
  void filters;
  throw new Error("TODO");
}

export async function getContact(id: string): Promise<Contact | null> {
  void id;
  throw new Error("TODO");
}

export async function getContactByEmail(email: string): Promise<Contact | null> {
  void email;
  throw new Error("TODO");
}

export interface ContactInput {
  name?: string | null;
  /** Either an id, or a name to find-or-create (case-insensitive). organizationId wins. */
  organizationId?: string | null;
  organizationName?: string | null;
  role?: string | null;
  notes?: string | null;
  tags?: string[];
  status?: ContactStatus;
  followUpAt?: string | null;
  followUpNote?: string | null;
  /** Replaces the contact's project memberships. */
  projectIds?: string[];
}

/**
 * Create a manual contact. Throws EmailTakenError if an address already belongs
 * to another contact. The first address is primary. Stats are refreshed so
 * existing mail with these addresses appears immediately.
 */
export async function createContact(input: ContactInput & { emails: string[] }): Promise<string> {
  void input;
  throw new Error("TODO");
}

/** Patch semantics: only keys present in `patch` are changed. Tags are normalized. */
export async function updateContact(id: string, patch: ContactInput): Promise<void> {
  void id;
  void patch;
  throw new Error("TODO");
}

export async function deleteContact(id: string): Promise<void> {
  void id;
  throw new Error("TODO");
}

export class EmailTakenError extends Error {
  readonly email: string;
  readonly contactId: string;
  constructor(email: string, contactId: string) {
    super(`${email} already belongs to another contact`);
    this.name = "EmailTakenError";
    this.email = email;
    this.contactId = contactId;
  }
}

/** Throws EmailTakenError when the address belongs to someone else. Refreshes stats. */
export async function addContactEmail(contactId: string, email: string): Promise<void> {
  void contactId;
  void email;
  throw new Error("TODO");
}

/** Refuses to remove the last address. Promotes another address to primary if needed. Refreshes stats. */
export async function removeContactEmail(contactId: string, email: string): Promise<void> {
  void contactId;
  void email;
  throw new Error("TODO");
}

export async function setPrimaryEmail(contactId: string, email: string): Promise<void> {
  void contactId;
  void email;
  throw new Error("TODO");
}

/** merge_contacts(target, source). */
export async function mergeContacts(targetId: string, sourceId: string): Promise<void> {
  void targetId;
  void sourceId;
  throw new Error("TODO");
}

/** "Mark done" on reply lists: reply_dismissed_at = now(). */
export async function dismissReply(contactId: string): Promise<void> {
  void contactId;
  throw new Error("TODO");
}

export async function addContactsToProject(contactIds: string[], projectId: string): Promise<void> {
  void contactIds;
  void projectId;
  throw new Error("TODO");
}

export async function removeContactFromProject(contactId: string, projectId: string): Promise<void> {
  void contactId;
  void projectId;
  throw new Error("TODO");
}

/** All tags in use with counts, most used first. */
export async function listTags(): Promise<{ tag: string; count: number }[]> {
  throw new Error("TODO");
}

/**
 * Complete email history with a contact (all addresses, all accounts),
 * de-duplicated by RFC 822 Message-ID, newest first.
 * `before` pages backwards; `q` filters with full-text search.
 */
export async function getContactHistory(
  contactId: string,
  options: { limit?: number; before?: Date; q?: string; includeAutomated?: boolean } = {},
): Promise<EmailMessage[]> {
  void contactId;
  void options;
  throw new Error("TODO");
}

/** Possible duplicates: other contacts with the same name (case-insensitive) or same address local part at a different domain. */
export async function findDuplicateCandidates(contactId: string): Promise<ContactSummary[]> {
  void contactId;
  throw new Error("TODO");
}
