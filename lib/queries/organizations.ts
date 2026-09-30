import "server-only";
import type { ContactSummary, EmailMessage, Organization } from "@/lib/types";

export async function listOrganizations(options: { q?: string; limit?: number } = {}): Promise<Organization[]> {
  void options;
  throw new Error("TODO");
}

export async function getOrganization(id: string): Promise<Organization | null> {
  void id;
  throw new Error("TODO");
}

/** Case-insensitive exact name match. */
export async function getOrganizationByName(name: string): Promise<Organization | null> {
  void name;
  throw new Error("TODO");
}

export interface OrganizationInput {
  name?: string;
  /** Lower-cased, "@" and "www." stripped, de-duplicated. */
  domains?: string[];
  website?: string | null;
  notes?: string | null;
  tags?: string[];
}

/** Returns the id. Also links unaffiliated contacts whose address matches one of the domains. */
export async function createOrganization(input: OrganizationInput & { name: string }): Promise<string> {
  void input;
  throw new Error("TODO");
}

/** Patch semantics. When domains change, links unaffiliated contacts with matching addresses. */
export async function updateOrganization(id: string, patch: OrganizationInput): Promise<void> {
  void id;
  void patch;
  throw new Error("TODO");
}

/** Contacts are kept (organization_id set null). */
export async function deleteOrganization(id: string): Promise<void> {
  void id;
  throw new Error("TODO");
}

/** Find by name (case-insensitive) or create. */
export async function findOrCreateOrganization(name: string): Promise<string> {
  void name;
  throw new Error("TODO");
}

/** Contacts of the organization (all statuses except archived), by last contact. */
export async function getOrganizationContacts(id: string): Promise<ContactSummary[]> {
  void id;
  throw new Error("TODO");
}

/**
 * All correspondence with the organization's contacts, de-duplicated,
 * newest first. `before` pages backwards; `q` full-text filter.
 */
export async function getOrganizationHistory(
  id: string,
  options: { limit?: number; before?: Date; q?: string } = {},
): Promise<EmailMessage[]> {
  void id;
  void options;
  throw new Error("TODO");
}

/** Set organization_id on contacts without an organization whose addresses use one of its domains. Returns count. */
export async function linkContactsByDomain(id: string): Promise<number> {
  void id;
  throw new Error("TODO");
}
