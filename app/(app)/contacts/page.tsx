import Link from "next/link";
import type { Metadata } from "next";
import { Archive, Check, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { ProjectBadge, StatusBadge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Avatar, EmptyState, Notice, PageHeader } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime, formatDue, formatRelative, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { listContacts, listTags, type ContactFilters } from "@/lib/queries/contacts";
import { listProjects } from "@/lib/queries/projects";
import { getOverviewCounts } from "@/lib/queries/stats";
import type { ContactStatus, ContactSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { triageContact } from "./actions";
import { FilterForm } from "./filter-form";

export const metadata: Metadata = { title: "Contacts" };

const PAGE_SIZE = 100;

const STATUS_OPTIONS: { value: "" | ContactStatus | "all"; label: string }[] = [
  { value: "", label: "All but archived" },
  { value: "new", label: "New (to review)" },
  { value: "lead", label: "Lead" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

const SORT_OPTIONS: { value: "" | NonNullable<ContactFilters["sort"]>; label: string }[] = [
  { value: "", label: "Last contact" },
  { value: "name", label: "Name" },
  { value: "created", label: "Newest" },
  { value: "follow_up", label: "Follow-up" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function pick<T extends string>(value: string, options: { value: T }[]): T | "" {
  return (options.find((o) => o.value === value)?.value ?? "") as T | "";
}

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const sp = await searchParams;
  const q = first(sp.q).slice(0, 200);
  const projectId = UUID_RE.test(first(sp.project)) ? first(sp.project) : "";
  const tag = first(sp.tag).slice(0, 100);
  const status = pick(first(sp.status), STATUS_OPTIONS);
  const sort = pick(first(sp.sort), SORT_OPTIONS);
  const offset = Math.max(0, Math.floor(Number(first(sp.offset)) || 0));

  const timezone = env.timezone;
  const today = todayIn(timezone);

  const [{ contacts, total }, projects, tags, counts] = await Promise.all([
    listContacts({
      q: q || undefined,
      projectId: projectId || undefined,
      tag: tag || undefined,
      status: status || undefined,
      sort: sort || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    listProjects(),
    listTags(),
    getOverviewCounts(),
  ]);

  const current: Record<string, string> = { q, project: projectId, tag, status, sort };
  const filtered = Boolean(q || projectId || tag || status);
  const triage = status === "new";

  const pageHref = (nextOffset: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(current)) if (value) params.set(key, value);
    if (nextOffset > 0) params.set("offset", String(nextOffset));
    const qs = params.toString();
    return qs ? `/contacts?${qs}` : "/contacts";
  };

  return (
    <>
      <PageHeader
        title={
          <>
            Contacts
            <span className="ml-2 text-base font-normal tabular-nums text-subtle">{counts.contacts}</span>
          </>
        }
        description={
          counts.newContacts > 0 && !triage ? (
            <Link href="/contacts?status=new" className="hover:text-fg">
              {counts.newContacts} new from email to review →
            </Link>
          ) : undefined
        }
        actions={
          <ButtonLink href="/contacts/new" variant="primary">
            <Plus className="size-4" strokeWidth={1.75} />
            New contact
          </ButtonLink>
        }
      />

      <FilterForm action="/contacts" className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Filter contacts">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
            strokeWidth={1.75}
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name, email, organization, role or tag"
            aria-label="Search contacts"
            className="pl-8"
          />
        </div>
        <Select name="project" defaultValue={projectId} aria-label="Project" className="w-auto">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select name="tag" defaultValue={tag} aria-label="Tag" className="w-auto">
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>
              #{t.tag} ({t.count})
            </option>
          ))}
          {tag && !tags.some((t) => t.tag === tag) ? <option value={tag}>#{tag}</option> : null}
        </Select>
        <Select name="status" defaultValue={status} aria-label="Status" className="w-auto">
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select name="sort" defaultValue={sort} aria-label="Sort by" className="w-auto">
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Sort: {o.label}
            </option>
          ))}
        </Select>
        <Button type="submit">Filter</Button>
        {filtered || sort ? (
          <Link href="/contacts" className="px-1 text-sm text-muted hover:text-fg">
            Clear
          </Link>
        ) : null}
      </FilterForm>

      {triage && contacts.length ? (
        <div className="mb-4">
          <Notice>
            These contacts were created automatically from your email. <span className="text-fg">Keep</span> the people who
            matter (they become Active) and <span className="text-fg">archive</span> the rest — archived contacts are hidden
            from lists and follow-ups, but their email stays searchable.
          </Notice>
        </div>
      ) : null}

      {contacts.length ? (
        <>
          {filtered ? (
            <p className="mb-2 text-xs text-subtle">
              {total} {total === 1 ? "contact" : "contacts"} {q ? <>matching “{q}”</> : "match these filters"}
            </p>
          ) : null}
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-subtle">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Name
                  </th>
                  <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                    Projects
                  </th>
                  <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                    Last contact
                  </th>
                  <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">
                    Follow-up
                  </th>
                  <th scope="col" className={cn("hidden py-2 font-medium sm:table-cell", triage ? "px-3" : "pl-3 pr-4")}>
                    Status
                  </th>
                  {triage ? (
                    <th scope="col" className="py-2 pl-3 pr-4 text-right font-medium">
                      <span className="sr-only">Review</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {contacts.map((c) => (
                  <ContactTableRow key={c.id} contact={c} timezone={timezone} today={today} triage={triage} />
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE ? (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span className="text-xs tabular-nums text-subtle">
                {offset + 1}–{Math.min(offset + contacts.length, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                {offset > 0 ? (
                  <ButtonLink href={pageHref(Math.max(0, offset - PAGE_SIZE))} variant="ghost" size="sm">
                    <ChevronLeft className="size-3.5" strokeWidth={1.75} />
                    Previous
                  </ButtonLink>
                ) : null}
                {offset + contacts.length < total ? (
                  <ButtonLink href={pageHref(offset + PAGE_SIZE)} variant="secondary" size="sm">
                    Next page
                    <ChevronRight className="size-3.5" strokeWidth={1.75} />
                  </ButtonLink>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      ) : offset > 0 ? (
        <EmptyState title="No more contacts" action={<ButtonLink href={pageHref(0)}>Back to the first page</ButtonLink>}>
          This page is past the end of the list.
        </EmptyState>
      ) : triage && !q && !projectId && !tag ? (
        <EmptyState title="Nothing to review" action={<ButtonLink href="/contacts">All contacts</ButtonLink>}>
          Every contact created from your email has been reviewed. New ones appear here as mail arrives.
        </EmptyState>
      ) : filtered ? (
        <EmptyState title="No contacts match" action={<ButtonLink href="/contacts">Clear filters</ButtonLink>}>
          {q ? <>Nothing matches “{q}” with these filters. </> : null}Try a different search, or include archived contacts
          with the “All” status.
        </EmptyState>
      ) : (
        <EmptyState
          title="No contacts yet"
          action={
            <div className="flex gap-2">
              <ButtonLink href="/contacts/new" variant="primary">
                New contact
              </ButtonLink>
              <ButtonLink href="/settings">Connect Gmail</ButtonLink>
            </div>
          }
        >
          Contacts are created automatically from the people you email once a Gmail account is connected. You can also add
          one by hand.
        </EmptyState>
      )}
    </>
  );
}

function ContactTableRow({
  contact: c,
  timezone,
  today,
  triage,
}: {
  contact: ContactSummary;
  timezone: string;
  today: string;
  triage: boolean;
}) {
  const subtitle =
    [c.role, c.organization?.name].filter(Boolean).join(" · ") ||
    (c.primaryEmail && c.primaryEmail !== c.displayName ? c.primaryEmail : "");
  const overdue = c.followUpAt !== null && c.followUpAt < today;
  const extraProjects = c.projects.length - 3;

  return (
    <tr className="hover:bg-surface-2/40">
      <td className="w-full max-w-0 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={c.displayName} />
          <div className="min-w-0">
            <Link href={`/contacts/${c.id}`} className="block truncate font-medium text-fg hover:underline">
              {c.displayName}
            </Link>
            {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
            {triage && c.messageCount > 0 ? (
              <p className="truncate text-xs text-subtle">
                {c.messageCount} {c.messageCount === 1 ? "email" : "emails"} · last {formatRelative(c.lastContactedAt, timezone)}
              </p>
            ) : null}
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-2.5 md:table-cell">
        {c.projects.length ? (
          <div className="flex items-center gap-1">
            {c.projects.slice(0, 3).map((p) => (
              <ProjectBadge key={p.id} project={p} />
            ))}
            {extraProjects > 0 ? (
              <span className="text-xs text-subtle" title={c.projects.slice(3).map((p) => p.name).join(", ")}>
                +{extraProjects}
              </span>
            ) : null}
          </div>
        ) : null}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-muted sm:table-cell">
        {c.lastContactedAt ? (
          <span title={formatDateTime(c.lastContactedAt, timezone)}>{formatRelative(c.lastContactedAt, timezone)}</span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs lg:table-cell">
        {c.followUpAt ? (
          <span className={overdue ? "text-danger" : "text-muted"} title={c.followUpNote ?? undefined}>
            {formatDue(c.followUpAt, today)}
          </span>
        ) : null}
      </td>
      <td className={cn("hidden py-2.5 sm:table-cell", triage ? "px-3" : "pl-3 pr-4")}>
        <StatusBadge status={c.status} />
      </td>
      {triage ? (
        <td className="py-2.5 pl-3 pr-4">
          <div className="flex items-center justify-end gap-1">
            <form action={triageContact.bind(null, c.id, "active")}>
              <SubmitButton variant="secondary" size="sm" aria-label={`Keep ${c.displayName}`} title="Keep — mark as Active">
                <Check className="size-3.5" strokeWidth={1.75} />
                Keep
              </SubmitButton>
            </form>
            <form action={triageContact.bind(null, c.id, "archived")}>
              <SubmitButton variant="ghost" size="sm" aria-label={`Archive ${c.displayName}`} title="Archive — hide from lists">
                <Archive className="size-3.5" strokeWidth={1.75} />
                Archive
              </SubmitButton>
            </form>
          </div>
        </td>
      ) : null}
    </tr>
  );
}
