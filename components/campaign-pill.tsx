import Link from "next/link";
import { Megaphone } from "lucide-react";
import { PROJECT_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface CampaignRef {
  id: string;
  name: string;
  color: string;
}

/** Colors a campaign without its own color takes (stable per campaign), so two campaigns never look alike. */
const PALETTE = ["blue", "violet", "teal", "orange", "pink", "green", "rose", "amber"];

export function campaignColor(campaign: CampaignRef): string {
  if (campaign.color && campaign.color !== "gray" && PROJECT_COLORS[campaign.color]) return campaign.color;
  let hash = 0;
  for (const ch of campaign.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/** "Booking USA 2026/27 · CreArtBox" → "Booking USA 2026/27" (the full name stays in the tooltip). */
export function campaignShortName(name: string): string {
  return name.split(" · ")[0].trim() || name;
}

/**
 * Which campaign an email or a person belongs to, at a glance: the campaign
 * icon, its short name, its color. A link to the campaign sheet unless it sits
 * inside another link (a mail list row).
 */
export function CampaignPill({ campaign, link = false, size = "sm" }: { campaign: CampaignRef; link?: boolean; size?: "sm" | "md" }) {
  const colors = PROJECT_COLORS[campaignColor(campaign)];
  const className = cn(
    "inline-flex max-w-52 shrink-0 items-center gap-1 rounded-full font-semibold",
    size === "md" ? "h-7 px-2.5 text-[13px] md:h-6 md:text-xs" : "h-5 px-2 text-[11px]",
    colors.badge,
  );
  const inner = (
    <>
      <Megaphone className={size === "md" ? "size-3.5 shrink-0" : "size-3 shrink-0"} strokeWidth={2.25} />
      <span className="truncate">{campaignShortName(campaign.name)}</span>
    </>
  );
  return link ? (
    <Link href={`/campaigns/${campaign.id}`} title={`Campaign: ${campaign.name}`} className={cn(className, "hover:opacity-80")}>
      {inner}
    </Link>
  ) : (
    <span title={`Campaign: ${campaign.name}`} className={className}>
      {inner}
    </span>
  );
}
