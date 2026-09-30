import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDownLeft, ArrowUpRight, Check, Clock } from "lucide-react";
import { ContactRow, RowList } from "@/components/contact-row";
import { StageBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, Notice, PageHeader, SectionTitle } from "@/components/ui/layout";
import { formatDue, formatRelative, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { getFollowUps, getUpcomingFollowUps } from "@/lib/queries/followups";
import { recentActivity } from "@/lib/queries/messages";
import { getOverviewCounts } from "@/lib/queries/stats";
import { cn, truncate } from "@/lib/utils";
import { completeFollowUp, completeOpportunityFollowUp, markReplyDone, snoozeFollowUp } from "./actions";

export const metadata: Metadata = { title: "Today" };

function IconAction({ action, label, children }: { action: () => Promise<void>; label: string; children: React.ReactNode }) {
  return (
    <form action={action}>
      <button
        type="submit"
        title={label}
        aria-label={label}
        className="inline-flex size-7 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg"
      >
        {children}
      </button>
    </form>
  );
}

export default async function TodayPage() {
  const timezone = env.timezone;
  const today = todayIn(timezone);
  const [followUps, upcoming, activity, counts] = await Promise.all([
    getFollowUps({ today, limit: 30 }),
    getUpcomingFollowUps({ today, days: 7, limit: 8 }),
    recentActivity(12),
    getOverviewCounts(),
  ]);

  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const nothingToDo =
    !followUps.due.length && !followUps.opportunities.length && !followUps.needsReply.length && !followUps.awaitingReply.length;

  return (
    <>
      <PageHeader title="Today" description={dateLabel} />

      {counts.accounts === 0 ? (
        <div className="mb-6">
          <EmptyState
            title="Connect your first Gmail account"
            action={<ButtonLink href="/settings" variant="primary">Connect Gmail</ButtonLink>}
          >
            Your email history is imported automatically and contacts are created from the people you correspond with.
          </EmptyState>
        </div>
      ) : counts.importing > 0 ? (
        <div className="mb-6">
          <Notice>
            Importing email history for {counts.importing} account{counts.importing === 1 ? "" : "s"}…{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Progress
            </Link>
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-8">
          {nothingToDo && counts.accounts > 0 ? (
            <EmptyState title="You're all caught up">No follow-ups due and nobody is waiting on you.</EmptyState>
          ) : null}

          {followUps.due.length || followUps.opportunities.length ? (
            <section>
              <SectionTitle count={followUps.due.length + followUps.opportunities.length}>Follow-ups due</SectionTitle>
              <RowList>
                {followUps.due.map((c) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    timezone={timezone}
                    today={today}
                    meta="follow_up"
                    note={c.followUpNote ?? undefined}
                    actions={
                      <>
                        <IconAction action={snoozeFollowUp.bind(null, c.id, 7)} label="Snooze one week">
                          <Clock className="size-3.5" />
                        </IconAction>
                        <IconAction action={completeFollowUp.bind(null, c.id)} label="Done">
                          <Check className="size-3.5" />
                        </IconAction>
                      </>
                    }
                  />
                ))}
                {followUps.opportunities.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-[10px] font-medium text-subtle">
                      Deal
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/pipeline?open=${o.id}`} className="truncate text-sm font-medium hover:underline">
                          {o.title}
                        </Link>
                        <StageBadge stage={o.stage} />
                      </div>
                      <p className="truncate text-xs text-muted">
                        {[o.nextStep, o.contact?.displayName, o.organization?.name].filter(Boolean).join(" · ") || "No next step"}
                      </p>
                    </div>
                    {o.followUpAt ? (
                      <span className={cn("hidden shrink-0 text-xs sm:block", o.followUpAt < today ? "text-danger" : "text-subtle")}>
                        {formatDue(o.followUpAt, today)}
                      </span>
                    ) : null}
                    <IconAction action={completeOpportunityFollowUp.bind(null, o.id)} label="Done">
                      <Check className="size-3.5" />
                    </IconAction>
                  </li>
                ))}
              </RowList>
            </section>
          ) : null}

          {followUps.needsReply.length ? (
            <section>
              <SectionTitle count={followUps.needsReply.length}>Needs your reply</SectionTitle>
              <RowList>
                {followUps.needsReply.map((c) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    timezone={timezone}
                    today={today}
                    meta="last_inbound"
                    actions={
                      <IconAction action={markReplyDone.bind(null, c.id)} label="Mark done">
                        <Check className="size-3.5" />
                      </IconAction>
                    }
                  />
                ))}
              </RowList>
            </section>
          ) : null}

          {followUps.awaitingReply.length ? (
            <section>
              <SectionTitle count={followUps.awaitingReply.length}>Waiting on them</SectionTitle>
              <RowList>
                {followUps.awaitingReply.map((c) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    timezone={timezone}
                    today={today}
                    meta="last_outbound"
                    actions={
                      <IconAction action={markReplyDone.bind(null, c.id)} label="Mark done">
                        <Check className="size-3.5" />
                      </IconAction>
                    }
                  />
                ))}
              </RowList>
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-8">
          {upcoming.length ? (
            <section>
              <SectionTitle>Coming up</SectionTitle>
              <RowList>
                {upcoming.map((c) => (
                  <ContactRow key={c.id} contact={c} timezone={timezone} today={today} meta="follow_up" note={c.followUpNote ?? undefined} />
                ))}
              </RowList>
            </section>
          ) : null}

          <section>
            <SectionTitle>Recent email</SectionTitle>
            {activity.length ? (
              <RowList>
                {activity.map((m) => {
                  const Icon = m.direction === "outbound" ? ArrowUpRight : ArrowDownLeft;
                  const who = m.contact?.displayName ?? (m.direction === "outbound" ? m.to[0]?.email : m.from?.name ?? m.from?.email) ?? "Unknown";
                  return (
                    <li key={m.id} className="flex items-start gap-2.5 px-4 py-2.5">
                      <Icon className={cn("mt-0.5 size-3.5 shrink-0", m.direction === "outbound" ? "text-subtle" : "text-fg")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          {m.contact ? (
                            <Link href={`/contacts/${m.contact.id}`} className="truncate text-sm font-medium hover:underline">
                              {who}
                            </Link>
                          ) : (
                            <span className="truncate text-sm font-medium">{who}</span>
                          )}
                          <span className="shrink-0 text-xs text-subtle">{formatRelative(m.sentAt, timezone)}</span>
                        </div>
                        <p className="truncate text-xs text-muted">{truncate(m.subject || m.snippet || "(no subject)", 80)}</p>
                      </div>
                    </li>
                  );
                })}
              </RowList>
            ) : (
              <p className="text-sm text-muted">No email yet.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
