import { CircleCheck, Clock, Hourglass } from "lucide-react";
import { EmptyState, SectionTitle } from "@/components/ui/layout";
import { stageLabel } from "@/lib/constants";
import { formatRelative } from "@/lib/dates";
import type { BookingSheet } from "@/lib/booking/types";
import type { OpportunityKind, OpportunityStage } from "@/lib/types";
import { getAssistantSettings, listAssistantActions, listAssistantDrafts, releasePostponed } from "@/lib/queries/assistant";
import { cn } from "@/lib/utils";
import { AssistantActionRow, AssistantDraftCard } from "./review";
import { BriefEditor } from "./sheet-controls";

/**
 * Booking sheet → "Next actions": what the daily assistant recommends for
 * this campaign, its emails waiting for approval, postponed items, progress
 * by stage, completed actions and the owner's brief. Server component.
 */

const STAGES: { stage: OpportunityStage; key: keyof BookingSheet["counts"]; bar: string }[] = [
  { stage: "lead", key: "toContact", bar: "bg-zinc-300 dark:bg-zinc-600" },
  { stage: "contacted", key: "contacted", bar: "bg-blue-500" },
  { stage: "proposal", key: "proposal", bar: "bg-violet-500" },
  { stage: "negotiation", key: "inConversation", bar: "bg-amber-500" },
  { stage: "won", key: "confirmed", bar: "bg-emerald-500" },
  { stage: "lost", key: "declined", bar: "bg-zinc-400 dark:bg-zinc-500" },
];

function Progress({ sheet, labelKind }: { sheet: BookingSheet; labelKind: OpportunityKind | null }) {
  const total = sheet.rows;
  return (
    <section aria-label="Progress">
      <SectionTitle>Progress</SectionTitle>
      <div className="rounded-xl border border-border bg-surface p-4 md:rounded-lg">
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Rows by stage">
          {total
            ? STAGES.map((s) =>
                sheet.counts[s.key] ? <span key={s.stage} className={s.bar} style={{ width: `${(sheet.counts[s.key] / total) * 100}%` }} /> : null,
              )
            : null}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm md:grid-cols-3">
          {STAGES.map((s) => (
            <li key={s.stage} className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", s.bar)} aria-hidden />
              <span className="text-muted">{stageLabel(s.stage, labelKind)}</span>
              <span className="ml-auto font-medium tabular-nums md:ml-0">{sheet.counts[s.key]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export async function NextActionsPanel({
  sheet,
  labelKind,
  today,
  timezone,
}: {
  sheet: BookingSheet;
  labelKind: OpportunityKind | null;
  today: string;
  timezone: string;
}) {
  await releasePostponed(today);
  const [settings, actions, drafts, waiting, postponedDrafts, postponedActions, completed] = await Promise.all([
    getAssistantSettings(sheet.id),
    listAssistantActions({ projectId: sheet.id, excludeDrafted: true }),
    listAssistantDrafts({ projectId: sheet.id }),
    listAssistantDrafts({ projectId: sheet.id, statuses: ["changes_requested"] }),
    listAssistantDrafts({ projectId: sheet.id, statuses: ["postponed"] }),
    listAssistantActions({ projectId: sheet.id, statuses: ["postponed"], excludeDrafted: true }),
    listAssistantActions({ projectId: sheet.id, statuses: ["done", "dismissed"], limit: 20 }),
  ]);
  const active = settings?.active ?? false;
  const lastRun = settings?.lastRunAt ? new Date(settings.lastRunAt) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <div className="flex flex-col gap-8">
        <p className="flex items-center gap-1.5 text-sm text-muted" data-testid="last-review">
          <Clock className="size-4 shrink-0" aria-hidden />
          {lastRun ? `Last review ${formatRelative(lastRun, timezone)}` : "Not reviewed yet"}
          {active ? " · reviews every day" : " · paused"}
        </p>

        <section aria-label="Recommended actions">
          <SectionTitle count={actions.length || undefined}>Recommended actions</SectionTitle>
          {actions.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
              {actions.map((a) => (
                <AssistantActionRow key={a.id} action={a} today={today} showProject={false} />
              ))}
            </ul>
          ) : (
            <EmptyState title="No actions recommended">
              {active
                ? "The assistant reviews this campaign every day and suggests calls, WhatsApps and tasks here."
                : "Turn the assistant on (Active) and it reviews this campaign every day."}
            </EmptyState>
          )}
        </section>

        <section aria-label="Emails awaiting approval">
          <SectionTitle count={drafts.length || undefined}>Emails awaiting approval</SectionTitle>
          {drafts.length ? (
            <div className="flex flex-col gap-3">
              {drafts.map((d) => (
                <AssistantDraftCard key={d.draft.id} draft={d.draft} projectName={d.projectName} priority={d.priority} today={today} showProject={false} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No emails waiting. Nothing is ever sent without your approval.</p>
          )}
        </section>

        {waiting.length ? (
          <section aria-label="Waiting for new version">
            <SectionTitle count={waiting.length}>Waiting for new version</SectionTitle>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
              {waiting.map(({ draft }) => (
                <li key={draft.id} className="flex items-start gap-2.5 px-4 py-3">
                  <Hourglass className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium md:text-sm">
                      {draft.contact?.displayName ?? draft.to.join(", ")} · {draft.subject}
                    </p>
                    {draft.revisionRequest ? <p className="text-sm text-muted md:text-xs">You asked: “{draft.revisionRequest}”</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {postponedDrafts.length || postponedActions.length ? (
          <section aria-label="Postponed">
            <SectionTitle count={postponedDrafts.length + postponedActions.length}>Postponed</SectionTitle>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
              {postponedDrafts.map(({ draft }) => (
                <li key={draft.id} className="flex items-center gap-2.5 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{draft.contact?.displayName ?? draft.to.join(", ")}</span>
                    <span className="text-muted"> · {draft.subject}</span>
                  </span>
                  <span className="shrink-0 text-xs text-subtle">Until {draft.postponedUntil}</span>
                </li>
              ))}
              {postponedActions.map((a) => (
                <AssistantActionRow key={a.id} action={a} today={today} showProject={false} />
              ))}
            </ul>
          </section>
        ) : null}

        {completed.length ? (
          <section aria-label="Completed">
            <SectionTitle>Completed</SectionTitle>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
              {completed.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">
                  <CircleCheck className={cn("size-4 shrink-0", a.status === "done" ? "text-emerald-600" : "text-subtle")} aria-hidden />
                  <span className={cn("min-w-0 flex-1 truncate", a.status === "dismissed" && "text-muted line-through")}>{a.title}</span>
                  <span className="shrink-0 text-xs text-subtle">{a.completedAt ? formatRelative(new Date(a.completedAt), timezone) : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="flex flex-col gap-8">
        <Progress sheet={sheet} labelKind={labelKind} />
        <section aria-label="Brief">
          <SectionTitle>Assistant brief</SectionTitle>
          <div className="rounded-xl border border-border bg-surface p-4 md:rounded-lg">
            <BriefEditor projectId={sheet.id} brief={settings?.brief ?? null} />
          </div>
        </section>
      </aside>
    </div>
  );
}
