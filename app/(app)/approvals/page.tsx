import type { Metadata } from "next";
import { DraftCard } from "@/components/draft-card";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/layout";
import { env } from "@/lib/env";
import { listDrafts, recoverStaleDrafts } from "@/lib/queries/drafts";
import { getSettings } from "@/lib/queries/settings";
import { PrepareDraftsButton } from "./prepare-button";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const timezone = env.timezone;
  await recoverStaleDrafts();
  const [open, recent, autopilot] = await Promise.all([
    listDrafts(),
    listDrafts({ statuses: ["sent"], limit: 10 }),
    getSettings("autopilot"),
  ]);

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          open.length
            ? `${open.length} email${open.length === 1 ? "" : "s"} prepared for you, waiting for your approval. Nothing is sent until you approve.`
            : "Emails prepared for you land here. Nothing is sent until you approve."
        }
        actions={env.claudeEnabled ? <PrepareDraftsButton /> : null}
      />

      <div className="flex flex-col gap-4">
        {open.length ? (
          open.map((draft) => <DraftCard key={draft.id} draft={draft} timezone={timezone} compact />)
        ) : (
          <EmptyState title="Nothing to approve">
            {!env.claudeEnabled
              ? "Nothing is waiting for your approval."
              : autopilot.enabled
              ? "The autopilot prepares replies and follow-ups every day. Tap “Prepare drafts” to run it now."
              : "Tap “Prepare drafts” and Claude will write replies and follow-ups for the people waiting on you. You can turn on the daily autopilot in Settings."}
          </EmptyState>
        )}
      </div>

      {recent.length ? (
        <section className="mt-10">
          <SectionTitle>Recently sent</SectionTitle>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
            {recent.map((d) => (
              <li key={d.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{d.contact?.displayName ?? d.to.join(", ")}</span>
                  <span className="text-muted"> · {d.subject}</span>
                </span>
                <span className="shrink-0 text-xs text-subtle">
                  {d.sentAt ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(d.sentAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
