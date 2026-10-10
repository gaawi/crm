/**
 * Today → filter by campaign (client and server). Each item on Today knows
 * the campaigns it belongs to; "All" (null) shows everything, a campaign
 * shows only its items (items outside every campaign appear under All only).
 */

export const TODAY_CAMPAIGN_PARAM = "campaign";
/** localStorage key of the last chosen campaign ("" = All). */
export const TODAY_CAMPAIGN_STORAGE_KEY = "crm:today:campaign";

export function inCampaign(campaigns: Iterable<string> | null | undefined, selected: string | null): boolean {
  if (!selected) return true;
  if (!campaigns) return false;
  for (const id of campaigns) if (id === selected) return true;
  return false;
}

/** How many of the items belong to each campaign (an item in two campaigns counts in both). */
export function countByCampaign(items: Iterable<Iterable<string> | null | undefined>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const campaigns of items) {
    if (!campaigns) continue;
    for (const id of new Set(campaigns)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export interface CampaignOption {
  id: string;
  name: string;
  count: number;
}

/**
 * The filter's options: campaigns with items today first (most first), then
 * the others (count 0), each group in the given order.
 */
export function campaignOptions(campaigns: { id: string; name: string }[], counts: Map<string, number>): CampaignOption[] {
  const withCount = campaigns.map((c, i) => ({ id: c.id, name: c.name, count: counts.get(c.id) ?? 0, i }));
  return withCount
    .sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || (a.count > 0 ? b.count - a.count : 0) || a.i - b.i)
    .map((c) => ({ id: c.id, name: c.name, count: c.count }));
}
