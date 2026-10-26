import type { Metadata } from "next";
import { Flashcards } from "@/components/approvals/flashcards";
import { cardFor } from "@/lib/approvals/card-data";
import { loadPendingApprovals } from "@/lib/approvals/pending";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { param } from "../../_lib/url";

export const metadata: Metadata = { title: "Review" };

/** Single emails one by one (flashcards), newest first. Mass mailings are approved on their own page, after reading the whole list. */
export default async function ReviewPage({ searchParams }: PageProps<"/approvals/review">) {
  const sp = await searchParams;
  const startId = param(sp, "start", 60) || null;
  const { drafts } = await loadPendingApprovals(new Date());
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
    />
  );
}
