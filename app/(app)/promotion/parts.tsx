import type { PartnerRelationship } from "@/lib/listings/relationship";

/**
 * A ticketing partner in one paragraph: what it is and how it works for us.
 * The full history stays in the data for ChatGPT; the emails show below.
 */
export function PartnerSummary({ relationship: r }: { relationship: PartnerRelationship }) {
  const text = r.summary ?? (r.howItWorks && r.howItWorks.length > 400 ? `${r.howItWorks.slice(0, 400).trimEnd()}…` : r.howItWorks);
  if (!text) return null;
  return <p className="whitespace-pre-line text-[15px] leading-relaxed text-fg md:text-sm">{text}</p>;
}
