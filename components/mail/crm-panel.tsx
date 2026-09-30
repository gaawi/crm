import Link from "next/link";
import { CalendarClock, Plus, UserPlus } from "lucide-react";
import { clearFollowUp, setFollowUpPreset } from "@/app/(app)/contacts/[id]/actions";
import { ProjectBadge, StageBadge, StatusBadge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { stageLabel } from "@/lib/constants";
import { formatDue, formatRelative, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { getContactByEmail } from "@/lib/queries/contacts";
import { listOpportunities } from "@/lib/queries/opportunities";
import type { Address, Contact, Opportunity } from "@/lib/types";
import { cn, initials } from "@/lib/utils";
import { ClaudePanel } from "./claude-panel";
import type { ComposeInit } from "./mail-provider";

const MAX_PEOPLE = 6;

/**
 * CRM context for a conversation: the other participants as contact cards
 * (status, organization, projects, follow-up with quick presets, last
 * contact, open deals), "Add as contact" for unknown people, and Claude.
 */
export async function CrmPanel({
  participants,
  accountId,
  threadId,
  reply,
  returnPath,
}: {
  participants: Address[];
  accountId: string;
  threadId: string;
  reply: ComposeInit | null;
  returnPath: string;
}) {
  const people = participants.slice(0, MAX_PEOPLE);
  const contacts = await Promise.all(people.map((p) => getContactByEmail(p.email)));
  // One card per contact even when several of their addresses are in the thread.
  const seen = new Set<string>();
  const entries = people
    .map((p, i) => ({ address: p, contact: contacts[i] }))
    .filter((e) => !e.contact || (!seen.has(e.contact.id) && seen.add(e.contact.id)));
  const deals = await Promise.all(entries.map((e) => (e.contact ? listOpportunities({ contactId: e.contact.id }) : Promise.resolve([]))));
  const today = todayIn(env.timezone);

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Contact">
        <h2 className="mb-1.5 px-4 text-[13px] uppercase tracking-wide text-subtle md:mb-2 md:px-0 md:text-xs md:font-medium">
          {entries.length > 1 ? "People" : "Contact"}
        </h2>
        {entries.length ? (
          <div className="flex flex-col gap-3">
            {entries.map((e, i) =>
              e.contact ? (
                <ContactCard key={e.contact.id} contact={e.contact} deals={deals[i]} today={today} returnPath={returnPath} />
              ) : (
                <UnknownCard key={e.address.email} address={e.address} />
              ),
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-3 text-[15px] text-muted md:rounded-lg md:text-sm">Only you are in this conversation.</p>
        )}
        {participants.length > MAX_PEOPLE ? (
          <p className="mt-2 px-4 text-[13px] text-subtle md:px-0 md:text-xs">+{participants.length - MAX_PEOPLE} more people in this conversation</p>
        ) : null}
      </section>
      <ClaudePanel accountId={accountId} threadId={threadId} reply={reply} />
    </div>
  );
}

function ContactCard({ contact, deals, today, returnPath }: { contact: Contact; deals: Opportunity[]; today: string; returnPath: string }) {
  const due = contact.followUpAt;
  const overdue = due !== null && due < today;
  const presets: { key: "1w" | "2w" | "1m"; label: string }[] = [
    { key: "1w", label: "+1w" },
    { key: "2w", label: "+2w" },
    { key: "1m", label: "+1m" },
  ];
  const newDeal = `/pipeline?${new URLSearchParams({ new: "1", contact: contact.id, return: returnPath })}`;
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5 md:px-3 md:pt-3">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[13px] font-medium text-muted md:size-9 md:text-xs">
          {initials(contact.displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/contacts/${contact.id}`} className="min-w-0 truncate text-[17px] font-semibold text-fg hover:underline md:text-sm">
              {contact.displayName}
            </Link>
            <StatusBadge status={contact.status} />
          </div>
          {contact.role || contact.organization ? (
            <p className="truncate text-[15px] text-muted md:text-xs">
              {contact.role}
              {contact.role && contact.organization ? " · " : null}
              {contact.organization ? (
                <Link href={`/organizations/${contact.organization.id}`} className="hover:text-fg hover:underline">
                  {contact.organization.name}
                </Link>
              ) : null}
            </p>
          ) : null}
          {contact.primaryEmail ? <p className="truncate text-[13px] text-subtle md:text-xs">{contact.primaryEmail}</p> : null}
        </div>
      </div>

      {contact.projects.length ? (
        <div className="flex flex-wrap gap-1 px-4 pb-3 md:px-3">
          {contact.projects.map((p) => (
            <ProjectBadge key={p.id} project={p} />
          ))}
        </div>
      ) : null}

      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-1 border-t border-border px-4 py-2.5 text-[15px] md:grid-cols-[5.5rem_minmax(0,1fr)] md:px-3 md:text-xs">
        <dt className="text-muted">Last contact</dt>
        <dd className="text-fg">{formatRelative(contact.lastContactedAt, env.timezone)}</dd>
        <dt className="text-muted">Follow-up</dt>
        <dd className={cn("flex items-center gap-1", overdue ? "font-medium text-danger" : "text-fg")}>
          {due ? (
            <>
              <CalendarClock className="size-3.5 shrink-0" />
              {formatDue(due, today)}
            </>
          ) : (
            <span className="text-muted">None</span>
          )}
        </dd>
      </dl>
      {contact.followUpNote ? <p className="-mt-1 px-4 pb-2 text-[13px] text-muted md:px-3 md:text-xs">{contact.followUpNote}</p> : null}

      <div className="grid grid-cols-4 gap-1.5 border-t border-border px-3 py-2.5">
        {presets.map((p) => (
          <form key={p.key} action={setFollowUpPreset.bind(null, contact.id, p.key)} className="contents">
            <SubmitButton variant="secondary" size="sm" className="px-1 md:px-1.5" title={`Follow up in ${p.label.slice(1)}`}>
              {p.label}
            </SubmitButton>
          </form>
        ))}
        {due ? (
          <form action={clearFollowUp.bind(null, contact.id)} className="contents">
            <SubmitButton variant="ghost" size="sm" className="px-1 md:px-1.5">
              Clear
            </SubmitButton>
          </form>
        ) : null}
      </div>

      {deals.length ? (
        <ul className="border-t border-border px-4 py-2 md:px-3">
          {deals.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-1">
              <Link href={`/pipeline?open=${d.id}`} className="min-w-0 truncate text-[15px] hover:underline md:text-xs">
                {d.title}
              </Link>
              <StageBadge stage={d.stage} label={stageLabel(d.stage, d.kind)} />
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex border-t border-border text-[15px] md:text-xs">
        <Link href={newDeal} className="flex h-11 flex-1 items-center justify-center gap-1.5 text-fg/80 hover:bg-surface-2 md:h-8">
          <Plus className="size-4 md:size-3.5" /> New deal
        </Link>
        <Link href={`/contacts/${contact.id}`} className="flex h-11 flex-1 items-center justify-center border-l border-border text-fg/80 hover:bg-surface-2 md:h-8">
          Open contact
        </Link>
      </div>
    </article>
  );
}

function UnknownCard({ address }: { address: Address }) {
  const href = `/contacts/new?${new URLSearchParams({ email: address.email, ...(address.name ? { name: address.name } : {}) })}`;
  return (
    <article className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 md:rounded-lg md:px-3">
      <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[13px] text-subtle md:size-9 md:text-xs">
        {initials(address.name || address.email)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px] font-medium md:text-sm">{address.name || address.email}</p>
        {address.name ? <p className="truncate text-[13px] text-subtle md:text-xs">{address.email}</p> : <p className="text-[13px] text-subtle md:text-xs">Not in the CRM</p>}
      </div>
      <Link
        href={href}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[15px] font-medium hover:bg-surface-2 md:h-7 md:rounded-md md:px-2 md:text-xs"
      >
        <UserPlus className="size-4 md:size-3.5" /> Add as contact
      </Link>
    </article>
  );
}
