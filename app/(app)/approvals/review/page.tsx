import type { Metadata } from "next";
import { Flashcards } from "@/components/approvals/flashcards";
import { cardFor } from "@/lib/approvals/card-data";
import { loadPendingApprovals, OTHER_SHEET } from "@/lib/approvals/pending";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { pickerEvents, upcomingGuestListEvents } from "@/lib/queries/guests";
import { param } from "../../_lib/url";

export const metadata: Metadata = { title: "Review" };

/** Single emails one by one (flashcards), newest first. Mass mailings are approved on their own page, after reading the whole list. */
export default async function ReviewPage({ searchParams }: PageProps<"/approvals/review">) {
  const sp = await searchParams;
  const startId = param(sp, "start", 60) || null;
  const [pending, upcoming] = await Promise.all([loadPendingApprovals(new Date()), upcomingGuestListEvents()]);
  // From Today's piles: only one booking sheet's emails ("other" = no sheet); none = all of them.
  const sheet = param(sp, "sheet", 60);
  const drafts = sheet ? pending.drafts.filter((d) => (d.campaign?.id ?? OTHER_SHEET) === sheet) : pending.drafts;
  // The upcoming concerts for the guest list rows on each card (the next one shown, the rest under "More").
  const concerts = pickerEvents(upcoming);
  // The first two cards arrive with the page (conversation and back), so nothing loads after it opens.
  const open = drafts.filter((d) => d.status !== "sent" && d.status !== "discarded");
  const from = Math.max(0, open.findIndex((d) => d.id === startId));
  const first = open.slice(from, from + 2);
  const cards = await Promise.all(first.map(async (d) => [d.id, await cardFor(d.id)] as const));
  const timezone = env.timezone;
  return (
    <Flashcards
      drafts={drafts}
      timezone={timezone}
      today={todayIn(timezone)}
      startId={startId}
      initialCards={Object.fromEntries(cards)}
      concerts={concerts}
    />
  );
}
