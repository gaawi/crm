import { OPPORTUNITY_STAGES } from "@/lib/constants";
import type { OpportunityStage } from "@/lib/types";
import { rowFit, type FilterRow } from "./filters";

/**
 * One line that says what a sheet section holds, for its folded header:
 * how many rows per status, then how many are prestigious, high fit and within
 * about 5 hours of New York. "31 · 25 to contact · 4 contacted · 6 prestigious · 12 high fit".
 */
export function sectionSummary(
  rows: readonly (Pick<FilterRow, "organization"> & { stage: OpportunityStage })[],
  labelFor: (stage: OpportunityStage) => string,
): string {
  const parts: string[] = [];
  for (const { value } of OPPORTUNITY_STAGES) {
    const n = rows.filter((r) => r.stage === value).length;
    if (n) parts.push(`${n} ${labelFor(value).toLowerCase()}`);
  }
  const vip = rows.filter((r) => r.organization?.tags?.includes("prestigious")).length;
  const high = rows.filter((r) => rowFit(r) === "high").length;
  const near = rows.filter((r) => r.organization?.tags?.includes("nyc-under-5h")).length;
  if (vip) parts.push(`${vip} prestigious`);
  if (high) parts.push(`${high} high fit`);
  if (near) parts.push(`${near} < 5 h NYC`);
  return parts.join(" · ");
}
