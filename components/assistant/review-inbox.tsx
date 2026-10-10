import Link from "next/link";
import { EmptyState, SectionTitle } from "@/components/ui/layout";
import { countAssistantSheets, listAssistantActions, listAssistantDrafts, releasePostponed } from "@/lib/queries/assistant";
import { AssistantActionRow, AssistantDraftCard } from "./review";

/**
 * Today → "To review today": every email the daily campaign assistant
 * prepared in active campaigns, and its recommended actions. Server component.
 */
export async function ReviewInbox({ today }: { today: string }) {
  await releasePostponed(today);
  const [drafts, actions, sheets] = await Promise.all([
    listAssistantDrafts({ activeOnly: true, limit: 50 }),
    listAssistantActions({ activeOnly: true, excludeDrafted: true, limit: 30 }),
    countAssistantSheets(),
  ]);
  const count = drafts.length + actions.length;

  return (
    <section aria-label="To review today" data-testid="review-inbox">
      <SectionTitle count={count || undefined}>To review today</SectionTitle>
      {count === 0 ? (
        <EmptyState title={sheets.active ? "Nothing to review right now" : "Your daily campaign review"}>
          {sheets.active
            ? "Every day the assistant reviews your active campaigns and prepares emails and next actions here. Nothing is sent until you approve it."
            : sheets.total
              ? "Turn on the assistant in a booking sheet and, every day, it prepares emails and next actions for you to review here. Nothing is sent without your approval."
              : "Create a booking sheet and turn on its assistant: every day it prepares emails and next actions for you to review here."}
          {!sheets.active && sheets.total ? (
            <>
              {" "}
              <Link href="/booking" className="underline underline-offset-2">
                Open booking sheets
              </Link>
            </>
          ) : null}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {drafts.map((d) => (
            <AssistantDraftCard key={d.draft.id} draft={d.draft} projectName={d.projectName} priority={d.priority} today={today} />
          ))}
          {actions.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
              {actions.map((a) => (
                <AssistantActionRow key={a.id} action={a} today={today} />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
