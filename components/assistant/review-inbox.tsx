import Link from "next/link";
import { EmptyState, SectionTitle } from "@/components/ui/layout";
import type { AssistantAction } from "@/lib/assistant/types";
import { countAssistantSheets, listAssistantActions, listAssistantDrafts, releasePostponed, type AssistantDraft } from "@/lib/queries/assistant";
import { AssistantActionRow, AssistantDraftCard } from "./review";

export interface ReviewInboxData {
  drafts: AssistantDraft[];
  actions: AssistantAction[];
  sheets: { active: number; total: number };
}

/** What Today's "To review today" lists: the assistant's emails and recommended actions in active campaigns. */
export async function loadReviewInbox(today: string): Promise<ReviewInboxData> {
  await releasePostponed(today);
  const [drafts, actions, sheets] = await Promise.all([
    listAssistantDrafts({ activeOnly: true, limit: 50 }),
    listAssistantActions({ activeOnly: true, excludeDrafted: true, limit: 30 }),
    countAssistantSheets(),
  ]);
  return { drafts, actions, sheets };
}

/**
 * Today → "To review today": every email the daily campaign assistant
 * prepared in active campaigns, and its recommended actions. Server component.
 * `campaignName`: Today is filtered to that campaign (`data` already is).
 */
export function ReviewInbox({ today, data, campaignName }: { today: string; data: ReviewInboxData; campaignName?: string | null }) {
  const { drafts, actions, sheets } = data;
  const count = drafts.length + actions.length;

  return (
    <section aria-label="To review today" data-testid="review-inbox">
      <SectionTitle count={count || undefined}>To review today</SectionTitle>
      {count === 0 && campaignName ? (
        <EmptyState title={`Nothing to review in ${campaignName}`}>The assistant has no emails or actions for this campaign right now.</EmptyState>
      ) : count === 0 ? (
        <EmptyState title={sheets.active ? "Nothing to review right now" : "Your daily campaign review"}>
          {sheets.active
            ? "Every day the assistant reviews your active campaigns and prepares emails and next actions here. Nothing is sent until you approve it."
            : sheets.total
              ? "Turn on the assistant in a campaign and, every day, it prepares emails and next actions for you to review here. Nothing is sent without your approval."
              : "Create a campaign and turn on its assistant: every day it prepares emails and next actions for you to review here."}
          {!sheets.active && sheets.total ? (
            <>
              {" "}
              <Link href="/campaigns" className="underline underline-offset-2">
                Open campaigns
              </Link>
            </>
          ) : null}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {drafts.map((d) => (
            <AssistantDraftCard
              key={d.draft.id}
              draft={d.draft}
              projectName={d.projectName}
              priority={d.priority}
              today={today}
              showProject={!campaignName}
            />
          ))}
          {actions.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
              {actions.map((a) => (
                <AssistantActionRow key={a.id} action={a} today={today} showProject={!campaignName} />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
