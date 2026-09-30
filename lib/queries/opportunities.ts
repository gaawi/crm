import "server-only";
import type { Opportunity, OpportunityStage } from "@/lib/types";

export interface OpportunityFilters {
  stage?: OpportunityStage;
  projectId?: string;
  contactId?: string;
  organizationId?: string;
  /** Default false: won/lost excluded unless a stage filter asks for them. */
  includeClosed?: boolean;
}

/** Ordered by follow_up_at (nulls last), then updated_at desc. */
export async function listOpportunities(filters: OpportunityFilters = {}): Promise<Opportunity[]> {
  void filters;
  throw new Error("TODO");
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  void id;
  throw new Error("TODO");
}

export interface OpportunityInput {
  title?: string;
  stage?: OpportunityStage;
  contactId?: string | null;
  organizationId?: string | null;
  projectId?: string | null;
  /** Decimal string or number; empty → null. */
  value?: string | number | null;
  currency?: string;
  followUpAt?: string | null;
  nextStep?: string | null;
  notes?: string | null;
}

/**
 * When a contact is given and organizationId is not, the contact's organization is used.
 * closed_at is set when the stage is won/lost.
 */
export async function createOpportunity(input: OpportunityInput & { title: string }): Promise<string> {
  void input;
  throw new Error("TODO");
}

/** Patch semantics. Moving to won/lost sets closed_at; moving back to an open stage clears it. */
export async function updateOpportunity(id: string, patch: OpportunityInput): Promise<void> {
  void id;
  void patch;
  throw new Error("TODO");
}

export async function deleteOpportunity(id: string): Promise<void> {
  void id;
  throw new Error("TODO");
}
