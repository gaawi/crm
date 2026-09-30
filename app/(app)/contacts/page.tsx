import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archive, Check, ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { ProjectBadge, ProjectDot, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Avatar, EmptyState, Notice, PageHeader } from "@/components/ui/layout";
import { formatDateTime, formatDue, formatRelative, todayIn } from "@/lib/dates";
import { env } from "@/lib/env";
import { listContacts, listTags, type ContactFilters } from "@/lib/queries/contacts";
import { listProjects } from "@/lib/queries/projects";
import { getOverviewCounts } from "@/lib/queries/stats";
import type { ContactStatus, ContactSummary, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Dropdown } from "../_components/dropdown";
import { FilterForm } from "../_components/filter-form";
import { HeaderAddButton, SearchInput } from "../_components/ui";
import { hrefWith, param } from "../_lib/url";
import { triageContact } from "./actions";

export const metadata: Metadata = { title: "Contacts" };

const PAGE_SIZE = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function pick<T extends string>(value: string, options: { value: T }[]): T | "" {
  return (options.find((o) => o.value === value)?.value ?? "") as T | "";
}

interface Current {
  q: string;
  project: string;
  tag: string;
  status: string;
  sort: string;
}

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const sp = await searchParams;
  const q = param(sp, "q");
  const projectId = UUID_RE.test(param(sp, "project")) ? param(sp, "project") : "";
  const tag = param(sp, "tag", 100);
  const status = pick(param(sp, "status"), STATUS_OPTIONS);
  const sort = pick(param(sp, "sort"), SORT_OPTIONS);
  const offset = Math.max(0, Math.floor(Number(param(sp, "offset")) || 0));

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

  const current: Current = { q, project: projectId, tag, status, sort };
  const filtered = Boolean(q || projectId || tag || status);
  const triage = status === "new";
  const pageHref = (nextOffset: number) => hrefWith("/contacts", { ...current, offset: nextOffset > 0 ? nextOffset : null });
  const without = (key: keyof Current) => hrefWith("/contacts", { ...current, [key]: "" });

  const project = projects.find((p) => p.id === projectId);
  const chips: { key: keyof Current; label: ReactNode }[] = [];
  if (project) chips.push({ key: "project", label: project.name });
  if (tag) chips.push({ key: "tag", label: `#${tag}` });
  if (status) chips.push({ key: "status", label: STATUS_OPTIONS.find((o) => o.value === status)?.label });
  if (sort) chips.push({ key: "sort", label: `Sort: ${SORT_OPTIONS.find((o) => o.value === sort)?.label}` });

  const selects = <FilterSelects projects={projects} tags={tags} current={current} />;

  return (
    <>
      <PageHeader
        title={
          <>
            Contacts
            <span className="ml-2 text-lg font-normal tabular-nums text-subtle md:text-base">{counts.contacts}</span>
          </>
        }
        description={
          counts.newContacts > 0 && !triage ? (
            <Link href="/contacts?status=new" className="text-[15px] hover:text-fg md:text-sm">
              {counts.newContacts} new from email to review →
            </Link>
          ) : undefined
        }
        actions={<HeaderAddButton href="/contacts/new" label="New contact" />}
      />

      {/* Desktop: one compact row. */}
      <FilterForm action="/contacts" className="mb-4 hidden items-center gap-2 md:flex" role="search" aria-label="Filter contacts">
        <SearchInput name="q" defaultValue={q} placeholder="Search name, email, organization or tag" aria-label="Search contacts" className="flex-1" />
        {selects}
        {filtered || sort ? (
          <Link href="/contacts" className="shrink-0 px-1 text-sm text-muted hover:text-fg">
            Clear
          </Link>
        ) : null}
      </FilterForm>

      {/* Phone: search + a Filters menu. */}
      <div className="mb-4 md:hidden">
        <FilterForm action="/contacts" className="relative flex items-center gap-2" role="search" aria-label="Filter contacts">
          <SearchInput name="q" defaultValue={q} placeholder="Search" aria-label="Search contacts" className="flex-1" />
          <Dropdown
            label="Filters"
            positioned={false}
            summaryClassName="flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[15px] text-fg active:bg-surface-2"
            panelClassName="inset-x-0 mt-2 gap-0 p-0 overflow-hidden divide-y divide-border"
            trigger={
              <>
                <SlidersHorizontal className="size-4" strokeWidth={1.75} />
                Filters
                {chips.length ? (
                  <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">
                    {chips.length}
                  </span>
                ) : null}
              </>
            }
          >
            <FilterSelects projects={projects} tags={tags} current={current} stacked />
          </Dropdown>
        </FilterForm>
        {chips.length ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <Link
                key={chip.key}
                href={without(chip.key)}
                className="inline-flex h-8 max-w-full items-center gap-1 rounded-full bg-surface-2 pl-3 pr-2 text-[13px] text-fg active:opacity-60"
              >
                <span className="truncate">{chip.label}</span>
                <X className="size-3.5 shrink-0 text-muted" strokeWidth={2} aria-label="Remove filter" />
              </Link>
            ))}
            <Link href={q ? hrefWith("/contacts", { q }) : "/contacts"} className="px-2 text-[13px] text-muted active:opacity-60">
              Clear all
            </Link>
          </div>
        ) : null}
      </div>

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
            <p className="mb-2 px-4 text-[13px] text-subtle md:px-0 md:text-xs">
              {total} {total === 1 ? "contact" : "contacts"} {q ? <>matching “{q}”</> : "match these filters"}
            </p>
          ) : null}
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
            <li
              aria-hidden
              className="hidden items-center gap-3 px-4 py-2 text-xs font-medium text-subtle md:flex"
            >
              <span className="flex-1 pl-11">Name</span>
              <span className="hidden w-44 shrink-0 lg:block">Projects</span>
              <span className="w-24 shrink-0">Last contact</span>
              <span className="hidden w-24 shrink-0 xl:block">Follow-up</span>
              <span className="w-20 shrink-0">Status</span>
              {triage ? <span className="w-[9.5rem] shrink-0" /> : null}
            </li>
            {contacts.map((c) => (
              <ContactListRow key={c.id} contact={c} timezone={timezone} today={today} triage={triage} />
            ))}
          </ul>

          {total > PAGE_SIZE ? (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 px-1 text-sm">
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

/** The four filter selects: inline (desktop) or as labelled rows (phone menu). */
function FilterSelects({
  projects,
  tags,
  current,
  stacked = false,
}: {
  projects: Project[];
  tags: { tag: string; count: number }[];
  current: Current;
  stacked?: boolean;
}) {
  const controls: { name: keyof Current; label: string; options: { value: string; label: string }[] }[] = [
    {
      name: "project",
      label: "Project",
      options: [{ value: "", label: "All projects" }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
    },
    {
      name: "tag",
      label: "Tag",
      options: [
        { value: "", label: "All tags" },
        ...tags.map((t) => ({ value: t.tag, label: `#${t.tag} (${t.count})` })),
        ...(current.tag && !tags.some((t) => t.tag === current.tag) ? [{ value: current.tag, label: `#${current.tag}` }] : []),
      ],
    },
    { name: "status", label: "Status", options: STATUS_OPTIONS },
    { name: "sort", label: "Sort by", options: SORT_OPTIONS },
  ];

  if (!stacked) {
    return controls.map((c) => (
      <Select
        key={c.name}
        name={c.name}
        defaultValue={current[c.name]}
        aria-label={c.label}
        className={cn("w-auto shrink-0", (c.name === "project" || c.name === "tag") && "max-w-44")}
      >
        {c.options.map((o) => (
          <option key={o.value} value={o.value}>
            {c.name === "sort" ? `Sort: ${o.label}` : o.label}
          </option>
        ))}
      </Select>
    ));
  }

  return controls.map((c) => (
    <label key={c.name} className="flex min-h-12 items-center justify-between gap-4 px-4">
      <span className="shrink-0 text-[15px] text-fg">{c.label}</span>
      <select
        name={c.name}
        defaultValue={current[c.name]}
        className="min-w-0 flex-1 appearance-none truncate bg-transparent py-3 text-right text-base text-muted focus:outline-none"
      >
        {c.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronRight className="size-4 shrink-0 text-subtle" strokeWidth={1.75} aria-hidden />
    </label>
  ));
}

function ContactListRow({
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
    (c.primaryEmail && c.primaryEmail !== c.displayName ? c.primaryEmail : "") ||
    (c.status === "new" ? "New from email — add details" : "");
  const overdue = c.followUpAt !== null && c.followUpAt < today;
  const extraProjects = c.projects.length - 3;

  return (
    <li className="relative flex min-h-[60px] items-center gap-3 px-4 py-2.5 active:bg-surface-2 md:min-h-0 md:hover:bg-surface-2/40 md:active:bg-surface-2/40">
      <Avatar name={c.displayName} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/contacts/${c.id}`}
            className="truncate text-[15px] font-medium text-fg after:absolute after:inset-0 md:text-sm md:hover:underline"
          >
            {c.displayName}
          </Link>
          {c.projects.length ? (
            <span className="flex shrink-0 items-center gap-1 lg:hidden" title={c.projects.map((p) => p.name).join(", ")}>
              {c.projects.slice(0, 4).map((p) => (
                <ProjectDot key={p.id} color={p.color} />
              ))}
            </span>
          ) : null}
        </div>
        {subtitle ? <p className="truncate text-[13px] text-muted md:text-xs">{subtitle}</p> : null}
        {triage && c.messageCount > 0 ? (
          <p className="truncate text-[13px] text-subtle md:text-xs">
            {c.messageCount} {c.messageCount === 1 ? "email" : "emails"} · last {formatRelative(c.lastContactedAt, timezone)}
          </p>
        ) : null}
      </div>

      <div className="hidden w-44 shrink-0 items-center gap-1 overflow-hidden lg:flex">
        {c.projects.slice(0, 3).map((p) => (
          <span key={p.id} className="relative z-10 min-w-0">
            <ProjectBadge project={p} />
          </span>
        ))}
        {extraProjects > 0 ? (
          <span className="text-xs text-subtle" title={c.projects.slice(3).map((p) => p.name).join(", ")}>
            +{extraProjects}
          </span>
        ) : null}
      </div>
      <span
        className={cn("shrink-0 text-[13px] tabular-nums text-subtle md:w-24 md:text-xs md:text-muted", triage && "hidden md:block")}
        title={c.lastContactedAt ? formatDateTime(c.lastContactedAt, timezone) : undefined}
      >
        {c.lastContactedAt ? formatRelative(c.lastContactedAt, timezone) : <span className="text-subtle">—</span>}
      </span>
      <span className="hidden w-24 shrink-0 text-xs xl:block">
        {c.followUpAt ? (
          <span className={overdue ? "text-danger" : "text-muted"} title={c.followUpNote ?? undefined}>
            {formatDue(c.followUpAt, today)}
          </span>
        ) : null}
      </span>
      <span className="hidden w-20 shrink-0 md:block">
        <StatusBadge status={c.status} />
      </span>

      {triage ? (
        <div className="relative z-10 flex shrink-0 items-center gap-2 md:w-[9.5rem] md:justify-end md:gap-1">
          <TriageButton action={triageContact.bind(null, c.id, "active")} label={`Keep ${c.displayName}`} title="Keep — mark as Active">
            <Check className="size-5 md:size-3.5" strokeWidth={1.75} />
            <span className="hidden md:inline">Keep</span>
          </TriageButton>
          <TriageButton action={triageContact.bind(null, c.id, "archived")} label={`Archive ${c.displayName}`} title="Archive — hide from lists" quiet>
            <Archive className="size-5 md:size-3.5" strokeWidth={1.75} />
            <span className="hidden md:inline">Archive</span>
          </TriageButton>
        </div>
      ) : null}
    </li>
  );
}

function TriageButton({
  action,
  label,
  title,
  quiet = false,
  children,
}: {
  action: () => Promise<void>;
  label: string;
  title: string;
  quiet?: boolean;
  children: ReactNode;
}) {
  return (
    <form action={action}>
      <button
        type="submit"
        aria-label={label}
        title={title}
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-full transition-colors active:opacity-60 md:h-7 md:w-auto md:gap-1.5 md:rounded-md md:px-2.5 md:text-xs md:font-medium",
          quiet
            ? "text-muted md:hover:bg-surface-2 md:hover:text-fg"
            : "border border-border bg-surface text-fg md:hover:bg-surface-2",
        )}
      >
        {children}
      </button>
    </form>
  );
}
