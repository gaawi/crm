import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { Archive, CalendarClock, Check, Ellipsis, GitMerge, Plus, Trash2, X } from "lucide-react";
import { DraftFollowUp } from "@/components/draft-follow-up";
import { EmailTimeline } from "@/components/email-timeline";
import { RowList } from "@/components/contact-row";
import { Badge, ProjectDot, StatusBadge, TagBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Avatar, Notice } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { CONTACT_STATUSES, PROJECT_COLORS } from "@/lib/constants";
import { sql } from "@/lib/db";
import { formatDate, formatDateTime, formatDue, formatRelative, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import {
  findDuplicateCandidates,
  getContact,
  getContactHistory,
  listContacts,
} from "@/lib/queries/contacts";
import { listOpportunities } from "@/lib/queries/opportunities";
import { listOrganizations } from "@/lib/queries/organizations";
import { listProjects } from "@/lib/queries/projects";
import { getOwnAddresses } from "@/lib/queries/stats";
import type { Contact, ContactSummary, Opportunity, Project } from "@/lib/types";
import { cn, initials } from "@/lib/utils";
import { ActionForm, FormSubmit } from "../../_components/action-form";
import { Dropdown } from "../../_components/dropdown";
import { FilterForm } from "../../_components/filter-form";
import { Segmented } from "../../_components/segmented";
import { BackLink, FormActions, GroupAction, GroupTitle, SearchInput, iconButtonClass, menuItemClass } from "../../_components/ui";
import { hrefWith, oneOf, param } from "../../_lib/url";
import { isId } from "../../_lib/validation";
import {
  addEmail,
  archiveContact,
  clearFollowUp,
  deleteContactAction,
  makePrimaryEmail,
  mergeFromAddEmail,
  mergeIntoContact,
  removeEmail,
  saveFollowUp,
  setFollowUpPreset,
  toggleProject,
  updateProfile,
} from "./actions";
import { AddEmailForm } from "./add-email-form";
import { DealRow } from "../../_components/deal-row";

const HISTORY_PAGE = 30;
const TABS = ["history", "details", "deals"] as const;
type Tab = (typeof TABS)[number];

const loadContact = cache(getContact);

export async function generateMetadata({ params }: PageProps<"/contacts/[id]">): Promise<Metadata> {
  const contact = await loadContact((await params).id);
  return { title: contact?.displayName ?? "Contact" };
}

export default async function ContactPage({ params, searchParams }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const contact = await loadContact(id);
  if (!contact) notFound();

  const timezone = env.timezone;
  const today = todayIn(timezone);
  const tab: Tab = oneOf(sp, "tab", TABS) || "history";
  const q = param(sp, "q");
  const beforeRaw = param(sp, "before", 40);
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : undefined;
  const editing = param(sp, "edit") === "profile";
  const merging = param(sp, "merge") === "1";
  const deleting = param(sp, "delete") === "1";
  const notice = param(sp, "notice");
  const base = `/contacts/${contact.id}`;

  const accountsQuery = sql<{ id: string; email: string }[]>`
    select id, email from gmail_accounts where status = 'active' order by created_at
  `;

  if (merging || deleting) {
    const mq = param(sp, "mq");
    const sourceId = isId(param(sp, "source")) && param(sp, "source") !== contact.id ? param(sp, "source") : "";
    const [source, results, duplicates] = await Promise.all([
      sourceId ? getContact(sourceId) : null,
      merging && mq ? listContacts({ q: mq, status: "all", limit: 21 }) : null,
      merging && !mq ? findDuplicateCandidates(contact.id) : [],
    ]);
    return (
      <div className="mx-auto max-w-2xl">
        <header className="mb-5 flex flex-col gap-3">
          <BackLink href={base} label={contact.displayName} />
          <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-xl md:font-semibold">
            {deleting ? "Delete contact" : `Merge into ${contact.displayName}`}
          </h1>
        </header>
        {deleting ? (
          <DeleteConfirm contact={contact} cancelHref={base} />
        ) : (
          <MergeScreen
            contact={contact}
            mq={mq}
            source={source}
            candidates={(results?.contacts ?? duplicates).filter((c) => c.id !== contact.id).slice(0, 20)}
            fromSearch={Boolean(mq)}
            timezone={timezone}
          />
        )}
      </div>
    );
  }

  const [history, selfEmails, deals, duplicates, projects, accounts, organizations] = await Promise.all([
    getContactHistory(contact.id, { limit: HISTORY_PAGE, before, q: q || undefined }),
    getOwnAddresses(),
    listOpportunities({ contactId: contact.id, includeClosed: true }),
    findDuplicateCandidates(contact.id),
    listProjects(),
    accountsQuery,
    editing ? listOrganizations({ limit: 500 }) : Promise.resolve([]),
  ]);

  const openDeals = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const olderHref =
    history.length === HISTORY_PAGE
      ? hrefWith(base, { q, before: history[history.length - 1].sentAt.toISOString() })
      : null;
  const show = (t: Tab) => (tab === t ? "" : "hidden md:flex");

  return (
    <>
      <ContactHeader contact={contact} accounts={accounts} />

      {notice === "merged" ? (
        <div className="mb-5">
          <Notice tone="success">Contacts merged. Addresses, email history, projects and deals are all here now.</Notice>
        </div>
      ) : null}

      <Segmented
        label="Sections"
        className="mb-5 md:hidden"
        segments={[
          { href: base, label: "History", active: tab === "history" },
          { href: `${base}?tab=details`, label: "Details", active: tab === "details" },
          { href: `${base}?tab=deals`, label: "Deals", active: tab === "deals", count: openDeals.length },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_23rem] [&>*]:min-w-0">
        <section className={cn("flex-col", show("history"), tab === "history" && "flex")} aria-label="Email history">
          <GroupTitle className="hidden md:flex">
            Email history
            {contact.messageCount ? <span className="ml-1.5 normal-case tracking-normal">{contact.messageCount}</span> : null}
          </GroupTitle>
          <FilterForm action={base} scroll={false} role="search" aria-label="Search this history" className="mb-3">
            <SearchInput
              name="q"
              defaultValue={q}
              placeholder={`Search emails with ${contact.name?.split(" ")[0] || "this contact"}`}
              aria-label="Search emails"
            />
          </FilterForm>
          {q || before ? (
            <p className="mb-2 px-4 text-[13px] text-subtle md:px-0 md:text-xs">
              {q ? <>Emails matching “{q}”</> : "Older emails"}
              {before ? <> before {formatDate(before, timezone)}</> : null} ·{" "}
              <Link href={base} scroll={false} className="text-muted underline-offset-2 hover:underline">
                {q ? "Clear search" : "Back to newest"}
              </Link>
            </p>
          ) : null}
          <EmailTimeline
            messages={history}
            timezone={timezone}
            selfEmails={selfEmails}
            olderHref={olderHref}
            emptyText={
              q
                ? `No emails match “${q}”.`
                : contact.emails.length
                  ? "No emails with this contact yet."
                  : "Add an email address to see the history with this contact."
            }
          />
        </section>

        <div className="flex flex-col gap-8 md:gap-7">
          <div className={cn("flex-col gap-8", show("details"), tab === "details" && "flex")}>
            <FollowUpSection contact={contact} today={today} />
          </div>
          <div className={cn("flex-col", show("deals"), tab === "deals" && "flex")}>
            <DealsSection contact={contact} deals={deals} today={today} />
          </div>
          <div className={cn("flex-col gap-8 md:gap-7", show("details"), tab === "details" && "flex")}>
            {editing ? (
              <ProfileForm contact={contact} organizations={organizations.map((o) => o.name)} cancelHref={`${base}?tab=details`} />
            ) : (
              <ProfileSection contact={contact} editHref={`${base}?tab=details&edit=profile`} />
            )}
            <EmailsSection contact={contact} />
            <ProjectsSection contact={contact} projects={projects} />
            <ActivitySection contact={contact} timezone={timezone} />
            {duplicates.length ? <DuplicatesSection contact={contact} duplicates={duplicates} /> : null}
          </div>
        </div>
      </div>
    </>
  );
}

/* Header ------------------------------------------------------------------- */

function ContactHeader({ contact, accounts }: { contact: Contact; accounts: { id: string; email: string }[] }) {
  const base = `/contacts/${contact.id}`;
  return (
    <header className="mb-6 flex flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <BackLink href="/contacts" label="Contacts" />
        <Dropdown label="More actions" trigger={<Ellipsis className="size-5" strokeWidth={1.75} />}>
          <Link href={`${base}?merge=1`} className={menuItemClass}>
            <GitMerge className="size-4 text-muted" strokeWidth={1.75} />
            Merge a duplicate…
          </Link>
          {contact.status !== "archived" ? (
            <form action={archiveContact.bind(null, contact.id)}>
              <button type="submit" className={menuItemClass}>
                <Archive className="size-4 text-muted" strokeWidth={1.75} />
                Archive
              </button>
            </form>
          ) : null}
          <Link href={`${base}?delete=1`} className={cn(menuItemClass, "text-danger")}>
            <Trash2 className="size-4" strokeWidth={1.75} />
            Delete…
          </Link>
        </Dropdown>
      </div>

      <div className="flex flex-col items-center gap-3 text-center md:flex-row md:gap-4 md:text-left">
        <span
          aria-hidden
          className="inline-flex size-20 shrink-0 items-center justify-center rounded-full bg-surface-2 text-2xl font-medium text-muted md:size-12 md:text-base"
        >
          {initials(contact.displayName)}
        </span>
        <div className="flex w-full min-w-0 flex-col items-center md:flex-1 md:items-start">
          <h1 className="max-w-full truncate text-[26px] font-bold leading-tight tracking-tight text-fg md:text-xl md:font-semibold">
            {contact.displayName}
          </h1>
          {contact.role || contact.organization ? (
            <p className="mt-0.5 max-w-full truncate text-[15px] text-muted md:text-sm">
              {contact.role}
              {contact.role && contact.organization ? " · " : null}
              {contact.organization ? (
                <Link href={`/organizations/${contact.organization.id}`} className="text-fg/80 hover:underline md:text-muted md:hover:text-fg">
                  {contact.organization.name}
                </Link>
              ) : null}
            </p>
          ) : null}
          <div className="mt-2 flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 md:justify-start">
            <StatusBadge status={contact.status} />
            {contact.primaryEmail && contact.primaryEmail !== contact.displayName ? (
              <a
                href={`mailto:${contact.primaryEmail}`}
                className="min-w-0 max-w-full truncate text-[15px] text-muted hover:text-fg md:text-sm"
              >
                {contact.primaryEmail}
              </a>
            ) : !contact.primaryEmail ? (
              <span className="text-[15px] text-subtle md:text-sm">No email address</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center empty:hidden md:items-start">
        {env.claudeEnabled ? <DraftFollowUp contactId={contact.id} accounts={accounts} hasEmail={contact.emails.length > 0} /> : null}
      </div>
    </header>
  );
}

/* Follow-up ---------------------------------------------------------------- */

function FollowUpSection({ contact, today }: { contact: Contact; today: string }) {
  const due = contact.followUpAt;
  const overdue = due !== null && due < today;
  const weekday = due
    ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(
        new Date(`${due}T12:00:00Z`),
      )
    : null;
  const presets: { key: "1w" | "2w" | "1m"; label: string }[] = [
    { key: "1w", label: "+1 week" },
    { key: "2w", label: "+2 weeks" },
    { key: "1m", label: "+1 month" },
  ];

  return (
    <section aria-label="Follow-up">
      <GroupTitle>Follow-up</GroupTitle>
      <div className="overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
        <div className="flex items-start gap-3 px-4 py-3">
          <CalendarClock className={cn("mt-0.5 size-5 shrink-0 md:size-4", overdue ? "text-danger" : "text-subtle")} strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            {due ? (
              <p className={cn("text-[15px] font-medium md:text-sm", overdue ? "text-danger" : "text-fg")}>
                {formatDue(due, today)}
                <span className="font-normal text-muted"> · {weekday}</span>
              </p>
            ) : (
              <p className="text-[15px] text-muted md:text-sm">No follow-up set</p>
            )}
            {contact.followUpNote ? <p className="mt-0.5 text-[13px] text-muted md:text-xs">{contact.followUpNote}</p> : null}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5 border-t border-border px-3 py-2.5 md:flex md:flex-wrap md:px-4">
          {presets.map((p) => (
            <form key={p.key} action={setFollowUpPreset.bind(null, contact.id, p.key)} className="contents">
              <SubmitButton variant="secondary" size="sm" className="px-1 md:px-2.5">
                {p.label}
              </SubmitButton>
            </form>
          ))}
          {due ? (
            <form action={clearFollowUp.bind(null, contact.id)} className="contents">
              <SubmitButton variant="ghost" size="sm" className="px-1 md:px-2.5">
                Clear
              </SubmitButton>
            </form>
          ) : null}
        </div>
        <details className="group border-t border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-[15px] text-fg/80 md:min-h-9 md:text-sm md:text-muted md:hover:text-fg [&::-webkit-details-marker]:hidden">
            {due ? "Change date or note" : "Pick a date and note"}
            <Plus className="size-4 text-subtle transition-transform group-open:rotate-45" strokeWidth={1.75} />
          </summary>
          <ActionForm action={saveFollowUp.bind(null, contact.id)} className="flex flex-col gap-3 px-4 pb-4" messageClassName="text-xs">
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)] lg:grid-cols-1">
              <Field label="Date" htmlFor="followUpAt">
                <Input id="followUpAt" name="followUpAt" type="date" defaultValue={due ?? ""} min={today} />
              </Field>
              <Field label="Note" htmlFor="followUpNote">
                <Input
                  id="followUpNote"
                  name="followUpNote"
                  defaultValue={contact.followUpNote ?? ""}
                  placeholder="What to follow up about"
                  autoComplete="off"
                />
              </Field>
            </div>
            <FormActions>
              <FormSubmit pendingLabel="Saving…">Save follow-up</FormSubmit>
            </FormActions>
          </ActionForm>
        </details>
      </div>
    </section>
  );
}

/* Deals -------------------------------------------------------------------- */

function DealsSection({ contact, deals, today }: { contact: Contact; deals: Opportunity[]; today: string }) {
  const addHref = hrefWith("/pipeline", { new: 1, contact: contact.id, return: `/contacts/${contact.id}?tab=deals` });
  return (
    <section aria-label="Deals">
      <GroupTitle
        actions={
          <GroupAction href={addHref}>
            <Plus className="size-4 md:size-3.5" strokeWidth={1.75} />
            Add
          </GroupAction>
        }
      >
        Deals
      </GroupTitle>
      {deals.length ? (
        <RowList>
          {deals.map((d) => (
            <DealRow key={d.id} deal={d} today={today} />
          ))}
        </RowList>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[15px] text-muted md:rounded-lg md:text-sm">
          No deals yet.{" "}
          <Link href={addHref} className="text-fg underline-offset-2 hover:underline">
            Add one
          </Link>
        </div>
      )}
    </section>
  );
}

/* Profile ------------------------------------------------------------------ */

function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="px-4 py-2.5 md:grid md:grid-cols-[6rem_minmax(0,1fr)] md:gap-3 md:py-2">
      <dt className="text-[13px] text-muted md:text-sm">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-[15px] text-fg md:mt-0 md:text-sm">{children}</dd>
    </div>
  );
}

function ProfileSection({ contact, editHref }: { contact: Contact; editHref: string }) {
  const statusHint = CONTACT_STATUSES.find((s) => s.value === contact.status)?.hint;
  return (
    <section aria-label="Profile">
      <GroupTitle actions={<GroupAction href={editHref}>Edit</GroupAction>}>Profile</GroupTitle>
      <dl className="divide-y divide-border rounded-xl border border-border bg-surface md:rounded-lg md:py-1 md:[&>div]:border-0">
        <InfoRow label="Name">{contact.name || <span className="text-subtle">—</span>}</InfoRow>
        <InfoRow label="Organization">
          {contact.organization ? (
            <Link href={`/organizations/${contact.organization.id}`} className="hover:underline">
              {contact.organization.name}
            </Link>
          ) : (
            <span className="text-subtle">—</span>
          )}
        </InfoRow>
        <InfoRow label="Role">{contact.role || <span className="text-subtle">—</span>}</InfoRow>
        <InfoRow label="Status">
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={contact.status} />
            {statusHint ? <span className="text-[13px] text-subtle md:text-xs">{statusHint}</span> : null}
          </span>
        </InfoRow>
        <InfoRow label="Tags">
          {contact.tags.length ? (
            <span className="flex flex-wrap gap-1">
              {contact.tags.map((t) => (
                <TagBadge key={t} tag={t} href={`/contacts?tag=${encodeURIComponent(t)}`} />
              ))}
            </span>
          ) : (
            <span className="text-subtle">—</span>
          )}
        </InfoRow>
        <InfoRow label="Notes">
          {contact.notes ? <p className="prose-plain">{contact.notes}</p> : <span className="text-subtle">—</span>}
        </InfoRow>
      </dl>
    </section>
  );
}

function ProfileForm({ contact, organizations, cancelHref }: { contact: Contact; organizations: string[]; cancelHref: string }) {
  return (
    <section aria-label="Edit profile">
      <GroupTitle>Edit profile</GroupTitle>
      <ActionForm
        action={updateProfile.bind(null, contact.id)}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg"
      >
        <Field label="Name" htmlFor="name">
          <Input id="name" name="name" defaultValue={contact.name ?? ""} autoComplete="off" autoCapitalize="words" />
        </Field>
        <Field label="Organization" htmlFor="organization" hint="Pick one or type a new name to create it.">
          <Input
            id="organization"
            name="organization"
            list="organization-options"
            defaultValue={contact.organization?.name ?? ""}
            autoComplete="off"
          />
          <datalist id="organization-options">
            {organizations.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Role" htmlFor="role">
          <Input id="role" name="role" defaultValue={contact.role ?? ""} autoComplete="off" />
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={contact.status}>
            {CONTACT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tags" htmlFor="tags" hint="Comma separated.">
          <Input id="tags" name="tags" defaultValue={contact.tags.join(", ")} autoComplete="off" autoCapitalize="off" />
        </Field>
        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" name="notes" rows={5} defaultValue={contact.notes ?? ""} />
        </Field>
        <FormActions>
          <FormSubmit pendingLabel="Saving…">Save</FormSubmit>
          <ButtonLink href={cancelHref} variant="ghost" scroll={false}>
            Cancel
          </ButtonLink>
        </FormActions>
      </ActionForm>
    </section>
  );
}

/* Email addresses ---------------------------------------------------------- */

function EmailsSection({ contact }: { contact: Contact }) {
  return (
    <section aria-label="Email addresses">
      <GroupTitle>Email addresses</GroupTitle>
      <div className="divide-y divide-border rounded-xl border border-border bg-surface md:rounded-lg">
        {contact.emails.map((email, index) => {
          const primary = index === 0;
          return (
            <div key={email} className="flex min-h-12 items-center gap-2 px-4 py-1.5 md:min-h-10">
              <a href={`mailto:${email}`} className="min-w-0 flex-1 truncate text-[15px] text-fg hover:underline md:text-sm">
                {email}
              </a>
              {primary ? (
                <Badge>Primary</Badge>
              ) : (
                <form action={makePrimaryEmail.bind(null, contact.id, email)}>
                  <button
                    type="submit"
                    className="h-9 shrink-0 rounded-md px-2 text-[13px] text-muted active:opacity-60 md:h-7 md:text-xs md:hover:bg-surface-2 md:hover:text-fg"
                  >
                    Make primary
                  </button>
                </form>
              )}
              {contact.emails.length > 1 ? (
                <form action={removeEmail.bind(null, contact.id, email)}>
                  <button type="submit" aria-label={`Remove ${email}`} title="Remove address" className={cn(iconButtonClass, "-mr-2 md:mr-0")}>
                    <X className="size-4 md:size-3.5" strokeWidth={1.75} />
                  </button>
                </form>
              ) : null}
            </div>
          );
        })}
        <AddEmailForm
          contactName={contact.displayName}
          action={addEmail.bind(null, contact.id)}
          mergeAction={mergeFromAddEmail.bind(null, contact.id)}
        />
      </div>
    </section>
  );
}

/* Projects ----------------------------------------------------------------- */

function ProjectsSection({ contact, projects }: { contact: Contact; projects: Project[] }) {
  if (!projects.length) return null;
  const member = new Set(contact.projects.map((p) => p.id));
  return (
    <section aria-label="Projects">
      <GroupTitle>Projects</GroupTitle>
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3 md:gap-1.5 md:rounded-lg">
        {projects.map((p) => {
          const on = member.has(p.id);
          return (
            <form key={p.id} action={toggleProject.bind(null, contact.id, p.id, on)}>
              <button
                type="submit"
                aria-pressed={on}
                title={on ? `Remove from ${p.name}` : `Add to ${p.name}`}
                className={cn(
                  "inline-flex h-9 select-none items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors active:opacity-60 md:h-7 md:px-2.5 md:text-xs",
                  on
                    ? cn("border-transparent font-medium", (PROJECT_COLORS[p.color] ?? PROJECT_COLORS.gray).badge)
                    : "border-border text-muted md:hover:border-border-strong md:hover:text-fg",
                )}
              >
                <ProjectDot color={p.color} />
                {p.name}
                {on ? <Check className="size-3.5 md:size-3" strokeWidth={2} aria-hidden /> : null}
              </button>
            </form>
          );
        })}
      </div>
    </section>
  );
}

/* Activity ----------------------------------------------------------------- */

function StatRow({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-4 text-[15px] md:min-h-0 md:py-1.5 md:text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate text-right text-fg" title={title}>
        {value}
      </dd>
    </div>
  );
}

function ActivitySection({ contact, timezone }: { contact: Contact; timezone: string }) {
  const when = (d: Date | null) => (d ? formatRelative(d, timezone) : <span className="text-subtle">never</span>);
  return (
    <section aria-label="Activity">
      <GroupTitle>Activity</GroupTitle>
      <dl className="divide-y divide-border rounded-xl border border-border bg-surface md:rounded-lg md:divide-y-0 md:py-1.5">
        <StatRow label="Emails" value={contact.messageCount.toLocaleString("en-US")} />
        <StatRow label="Last contact" value={when(contact.lastContactedAt)} title={formatDateTime(contact.lastContactedAt, timezone)} />
        <StatRow label="They last wrote" value={when(contact.lastInboundAt)} title={formatDateTime(contact.lastInboundAt, timezone)} />
        <StatRow label="You last wrote" value={when(contact.lastOutboundAt)} title={formatDateTime(contact.lastOutboundAt, timezone)} />
        <StatRow
          label="Added"
          value={`${formatDate(contact.createdAt, timezone)} · ${contact.source === "gmail" ? "from Gmail" : "by hand"}`}
        />
      </dl>
    </section>
  );
}

/* Duplicates & merge ------------------------------------------------------- */

function DuplicatesSection({ contact, duplicates }: { contact: Contact; duplicates: ContactSummary[] }) {
  return (
    <section aria-label="Possible duplicates">
      <GroupTitle>Possible duplicates</GroupTitle>
      <RowList>
        {duplicates.map((d) => (
          <li key={d.id} className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 md:min-h-0">
            <Avatar name={d.displayName} />
            <div className="min-w-0 flex-1">
              <Link href={`/contacts/${d.id}`} className="block truncate text-[15px] font-medium text-fg hover:underline md:text-sm">
                {d.displayName}
              </Link>
              <p className="truncate text-[13px] text-muted md:text-xs">
                {[d.primaryEmail, d.organization?.name].filter(Boolean).join(" · ")}
              </p>
            </div>
            <ButtonLink href={`/contacts/${contact.id}?merge=1&source=${d.id}`} size="sm" className="shrink-0">
              Merge…
            </ButtonLink>
          </li>
        ))}
      </RowList>
    </section>
  );
}

function MergeScreen({
  contact,
  mq,
  source,
  candidates,
  fromSearch,
  timezone,
}: {
  contact: Contact;
  mq: string;
  source: Contact | null;
  candidates: ContactSummary[];
  fromSearch: boolean;
  timezone: string;
}) {
  const base = `/contacts/${contact.id}`;
  if (source) {
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-xl border border-border bg-surface p-4 md:rounded-lg">
          <p className="text-[15px] text-fg md:text-sm">
            Merge <span className="font-medium">{source.displayName}</span> into{" "}
            <span className="font-medium">{contact.displayName}</span>?
          </p>
          <p className="mt-2 text-[15px] text-muted md:text-sm">
            {source.displayName}&rsquo;s addresses, email history, projects, tags, notes and deals move to {contact.displayName}.
            Empty fields are filled from {source.displayName}. Then {source.displayName} is deleted. This can&rsquo;t be undone.
          </p>
          <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px] md:text-xs">
            <dt className="text-subtle">Addresses</dt>
            <dd className="min-w-0 break-words text-muted">{source.emails.join(", ") || "none"}</dd>
            <dt className="text-subtle">Emails</dt>
            <dd className="text-muted">
              {source.messageCount} · last {formatRelative(source.lastContactedAt, timezone)}
            </dd>
            {source.organization ? (
              <>
                <dt className="text-subtle">Organization</dt>
                <dd className="truncate text-muted">{source.organization.name}</dd>
              </>
            ) : null}
          </dl>
        </div>
        <FormActions>
          <form action={mergeIntoContact.bind(null, contact.id, source.id)} className="contents">
            <SubmitButton pendingLabel="Merging…">Merge into {contact.displayName}</SubmitButton>
          </form>
          <ButtonLink href={hrefWith(base, { merge: 1, mq })} variant="ghost">
            Choose another
          </ButtonLink>
        </FormActions>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="px-4 text-[15px] text-muted md:px-0 md:text-sm">
        Find the duplicate of {contact.displayName}. Its addresses and history move here, then it is deleted.
      </p>
      <FilterForm action={base} scroll={false} role="search" aria-label="Find a contact to merge">
        <input type="hidden" name="merge" value="1" />
        <SearchInput name="mq" defaultValue={mq} placeholder="Search by name or email" aria-label="Search contacts" autoFocus={!mq} />
      </FilterForm>
      {candidates.length ? (
        <section>
          <GroupTitle>{fromSearch ? "Matches" : "Possible duplicates"}</GroupTitle>
          <RowList>
            {candidates.map((c) => (
              <li key={c.id} className="relative flex min-h-[60px] items-center gap-3 px-4 py-2.5 active:bg-surface-2 md:min-h-0 md:hover:bg-surface-2/40">
                <Avatar name={c.displayName} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={hrefWith(base, { merge: 1, mq, source: c.id })}
                    className="block truncate text-[15px] font-medium text-fg after:absolute after:inset-0 md:text-sm"
                  >
                    {c.displayName}
                  </Link>
                  <p className="truncate text-[13px] text-muted md:text-xs">
                    {[c.primaryEmail, c.organization?.name].filter(Boolean).join(" · ") || " "}
                  </p>
                </div>
                <span className="shrink-0 text-[13px] text-subtle md:text-xs">Select</span>
              </li>
            ))}
          </RowList>
        </section>
      ) : (
        <p className="py-6 text-center text-[15px] text-muted md:text-sm">
          {fromSearch ? `No other contact matches “${mq}”.` : "No likely duplicates. Search for the contact to merge."}
        </p>
      )}
      <FormActions>
        <ButtonLink href={base} variant="ghost">
          Cancel
        </ButtonLink>
      </FormActions>
    </div>
  );
}

function DeleteConfirm({ contact, cancelHref }: { contact: Contact; cancelHref: string }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border bg-surface p-4 md:rounded-lg">
        <p className="text-[15px] font-medium text-fg md:text-sm">Delete {contact.displayName}?</p>
        <p className="mt-2 text-[15px] text-muted md:text-sm">
          The contact, its addresses, notes and project memberships are removed. Emails stay searchable, and deals are kept
          without a contact.
          {contact.source === "gmail" ? " If you email them again, a new contact is created." : null}
        </p>
        {contact.status !== "archived" ? (
          <p className="mt-2 text-[15px] text-muted md:text-sm">
            To just hide them from lists and follow-ups, archive instead.
          </p>
        ) : null}
      </div>
      <FormActions>
        <form action={deleteContactAction.bind(null, contact.id)} className="contents">
          <SubmitButton variant="danger" pendingLabel="Deleting…">
            Delete contact
          </SubmitButton>
        </form>
        {contact.status !== "archived" ? (
          <form action={archiveContact.bind(null, contact.id)} className="contents">
            <SubmitButton variant="secondary" pendingLabel="Archiving…">
              Archive instead
            </SubmitButton>
          </form>
        ) : null}
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </FormActions>
    </div>
  );
}
