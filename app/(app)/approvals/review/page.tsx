import type { Metadata } from "next";
import { Flashcards } from "@/components/approvals/flashcards";
import { todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { releasePostponed } from "@/lib/queries/assistant";
import { listDrafts, recoverStaleDrafts } from "@/lib/queries/drafts";
import { param } from "../../_lib/url";

export const metadata: Metadata = { title: "Review emails" };

/** Approvals one by one (flashcards): the emails waiting for approval, newest first. */
export default async function ReviewPage({ searchParams }: PageProps<"/approvals/review">) {
  const sp = await searchParams;
  await recoverStaleDrafts();
  await releasePostponed();
  const drafts = (await listDrafts()).filter((d) => d.status === "proposed" || d.status === "failed");
  const timezone = env.timezone;
  return <Flashcards drafts={drafts} timezone={timezone} today={todayIn(timezone)} startId={param(sp, "start", 40) || null} />;
}
