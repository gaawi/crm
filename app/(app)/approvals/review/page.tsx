import type { Metadata } from "next";
import { Flashcards } from "@/components/approvals/flashcards";
import { loadPendingApprovals } from "@/lib/approvals/pending";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { param } from "../../_lib/url";

export const metadata: Metadata = { title: "Review" };

/** Approvals one by one (flashcards): mailings first, then single emails, newest first. */
export default async function ReviewPage({ searchParams }: PageProps<"/approvals/review">) {
  const sp = await searchParams;
  const { drafts, mailings } = await loadPendingApprovals(new Date(), { details: true });
  const timezone = env.timezone;
  return <Flashcards drafts={drafts} mailings={mailings} timezone={timezone} today={todayIn(timezone)} startId={param(sp, "start", 60) || null} />;
}
