import { Badge } from "@/components/ui/badge";
import { ORGANIZATION_KINDS } from "@/lib/constants";
import type { OrganizationKind } from "@/lib/types";

export function organizationKindLabel(kind: OrganizationKind | null | undefined): string | null {
  return kind ? (ORGANIZATION_KINDS.find((k) => k.value === kind)?.label ?? kind) : null;
}

export function OrganizationKindBadge({ kind }: { kind: OrganizationKind | null | undefined }) {
  const label = organizationKindLabel(kind);
  return label ? <Badge>{label}</Badge> : null;
}

/** The kind filter of the Organizations list. "other" groups every kind without its own segment. */
export const ORGANIZATION_FILTERS = [
  { value: "", label: "All" },
  { value: "venue", label: "Venues" },
  { value: "funder", label: "Funders" },
  { value: "partner", label: "Partners" },
  { value: "press", label: "Press" },
  { value: "other", label: "Other" },
] as const;

export type OrganizationFilter = (typeof ORGANIZATION_FILTERS)[number]["value"];

export function matchesOrganizationFilter(kind: OrganizationKind | null, filter: OrganizationFilter): boolean {
  if (!filter) return true;
  if (filter === "other") return !kind || !["venue", "funder", "partner", "press"].includes(kind);
  return kind === filter;
}
